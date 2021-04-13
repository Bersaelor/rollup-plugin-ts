import {ModuleMergerVisitorOptions, VisitResult} from "../module-merger-visitor-options";
import {TS} from "../../../../../../type/ts";
import {generateModuleSpecifier} from "../../../util/generate-module-specifier";
import {preserveMeta, preserveParents, preserveSymbols} from "../../../util/clone-node-with-meta";
import {ensureHasDeclareModifier} from "../../../util/modifier-util";
import {cloneLexicalEnvironment} from "../../../util/clone-lexical-environment";
import {ensureNoDeclareModifierTransformer} from "../../ensure-no-declare-modifier-transformer/ensure-no-declare-modifier-transformer";
import {statementMerger} from "../../statement-merger/statement-merger";
import {isNodeFactory} from "../../../util/is-node-factory";
import {inlineNamespaceModuleBlockTransformer} from "../../inline-namespace-module-block-transformer/inline-namespace-module-block-transformer";

export interface GenerateExportDeclarationsOptions extends Omit<ModuleMergerVisitorOptions<TS.ExportDeclaration>, "node"> {}

function generateExportDeclarations(options: GenerateExportDeclarationsOptions, exportDeclarations: TS.ExportDeclaration[] = []): TS.ExportDeclaration[] {
	const {sourceFile, sourceFileToExportedSymbolSet, compatFactory, typescript} = options;
	const exportedSymbols = sourceFileToExportedSymbolSet.get(sourceFile.fileName) ?? [];
	for (const symbol of exportedSymbols) {
		const matchingSourceFile = symbol.moduleSpecifier == null ? undefined : options.getMatchingSourceFile(symbol.moduleSpecifier, sourceFile);
		const generatedModuleSpecifier =
			symbol.moduleSpecifier == null
				? undefined
				: generateModuleSpecifier({
						...options,
						from: sourceFile.fileName,
						moduleSpecifier: symbol.moduleSpecifier
				  });

		// If it is a NamespaceExport, we may need to recursively add all exports for the referenced SourceFiles
		if ("isNamespaceExport" in symbol) {
			// If no SourceFile was matched, add the Namespace Export directly.
			// If the generated moduleSpecifier is null, that's because it is a self-reference, in which case the 'export *' declaration must be skipped
			// in favor of all other named export bindings that will included anyway
			if (matchingSourceFile == null && generatedModuleSpecifier != null) {
				exportDeclarations.push(
					preserveParents(
						isNodeFactory(compatFactory)
							? compatFactory.createExportDeclaration(undefined, undefined, false, undefined, compatFactory.createStringLiteral(generatedModuleSpecifier))
							: compatFactory.createExportDeclaration(undefined, undefined, undefined, compatFactory.createStringLiteral(generatedModuleSpecifier), false),
						{typescript}
					)
				);
			}

			// Otherwise, recursively add all exports for the reexported module
			else if (matchingSourceFile != null) {
				generateExportDeclarations(
					{
						...options,
						sourceFile: matchingSourceFile
					},
					exportDeclarations
				);
			}
		}

		// Otherwise, we can just add an ExportDeclaration with an ExportSpecifier
		else {
			const exportSpecifier = compatFactory.createExportSpecifier(
				symbol.propertyName.text === symbol.name.text ? undefined : compatFactory.createIdentifier(symbol.propertyName.text),
				compatFactory.createIdentifier(symbol.name.text)
			);

			exportDeclarations.push(
				preserveParents(
					isNodeFactory(compatFactory)
						? compatFactory.createExportDeclaration(
								undefined,
								undefined,
								false,
								compatFactory.createNamedExports([exportSpecifier]),
								symbol.moduleSpecifier == null || generatedModuleSpecifier == null || matchingSourceFile != null
									? undefined
									: compatFactory.createStringLiteral(generatedModuleSpecifier)
						  )
						: compatFactory.createExportDeclaration(
								undefined,
								undefined,
								compatFactory.createNamedExports([exportSpecifier]),
								symbol.moduleSpecifier == null || generatedModuleSpecifier == null || matchingSourceFile != null
									? undefined
									: compatFactory.createStringLiteral(generatedModuleSpecifier),
								false
						  ),
					{typescript}
				)
			);
			const propertyName = exportSpecifier.propertyName ?? exportSpecifier.name;
			preserveSymbols(propertyName, symbol.propertyName ?? symbol.name, options);
		}
	}
	return exportDeclarations;
}

export function visitExportDeclaration(options: ModuleMergerVisitorOptions<TS.ExportDeclaration>): VisitResult<TS.ExportDeclaration> {
	const {node, compatFactory, typescript} = options;
	const moduleSpecifier = node.moduleSpecifier == null || !typescript.isStringLiteralLike(node.moduleSpecifier) ? undefined : node.moduleSpecifier.text;
	const updatedModuleSpecifier =
		moduleSpecifier == null
			? undefined
			: generateModuleSpecifier({
					...options,
					from: options.sourceFile.fileName,
					moduleSpecifier
			  });

	const matchingSourceFile = moduleSpecifier == null ? undefined : options.getMatchingSourceFile(moduleSpecifier, options.sourceFile);

	const payload = {
		moduleSpecifier,
		matchingSourceFile
	};

	const contResult = options.childContinuation(node, payload);

	// If no SourceFile was resolved
	if (matchingSourceFile == null) {
		// If the module specifier didn't change, preserve the export as it is.
		if (moduleSpecifier === updatedModuleSpecifier || updatedModuleSpecifier == null) {
			return contResult;
		}

		// Otherwise, update the module specifier
		return preserveMeta(
			isNodeFactory(compatFactory)
				? compatFactory.updateExportDeclaration(
						contResult,
						contResult.decorators,
						contResult.modifiers,
						contResult.isTypeOnly,
						contResult.exportClause,
						compatFactory.createStringLiteral(updatedModuleSpecifier)
				  )
				: compatFactory.updateExportDeclaration(
						contResult,
						contResult.decorators,
						contResult.modifiers,
						contResult.exportClause,
						compatFactory.createStringLiteral(updatedModuleSpecifier),
						contResult.isTypeOnly
				  ),
			contResult,
			options
		);
	}

	// If it is a binding-less NamespaceExport (such as 'export * from "..."), we'll need to add explicit named ExportSpecifiers for all of the re-exported bindings instead
	if (contResult.exportClause == null) {
		options.prependNodes(...options.includeSourceFile(matchingSourceFile));
		return generateExportDeclarations({
			...options,
			typescript,
			sourceFile: matchingSourceFile
		});
	}

	// Otherwise, it if is a named NamespaceExport (such as 'export * as Foo from ".."), we can't just lose the module specifier since 'export * as Foo' isn't valid.
	// Instead, we must declare the namespace inline and add an ExportDeclaration with a named export for it
	else if (typescript.isNamespaceExport?.(contResult.exportClause)) {
		const importDeclarations: TS.ImportDeclaration[] = [];

		// Otherwise, prepend the nodes for the SourceFile in a namespace declaration
		const moduleBlock = compatFactory.createModuleBlock([
			...options.includeSourceFile(matchingSourceFile, {
				allowDuplicate: true,
				allowExports: "skip-optional",
				lexicalEnvironment: cloneLexicalEnvironment(),
				transformers: [
					ensureNoDeclareModifierTransformer,
					statementMerger({markAsModuleIfNeeded: false}),
					inlineNamespaceModuleBlockTransformer({
						intentToAddImportDeclaration: importDeclaration => {
							importDeclarations.push(importDeclaration);
						}
					})
				]
			})
		]);

		options.prependNodes(
			...importDeclarations.map(importDeclaration => preserveParents(importDeclaration, options)),
			preserveParents(
				compatFactory.createModuleDeclaration(
					undefined,
					ensureHasDeclareModifier(undefined, compatFactory, typescript),
					compatFactory.createIdentifier(contResult.exportClause.name.text),
					moduleBlock,
					typescript.NodeFlags.Namespace
				),
				options
			),
			preserveParents(
				isNodeFactory(compatFactory)
					? compatFactory.createExportDeclaration(
							undefined,
							undefined,
							false,
							compatFactory.createNamedExports([compatFactory.createExportSpecifier(undefined, compatFactory.createIdentifier(contResult.exportClause.name.text))]),
							undefined
					  )
					: compatFactory.createExportDeclaration(
							undefined,
							undefined,
							compatFactory.createNamedExports([compatFactory.createExportSpecifier(undefined, compatFactory.createIdentifier(contResult.exportClause.name.text))]),
							undefined,
							contResult.isTypeOnly
					  ),
				options
			)
		);
	}

	// Otherwise, preserve the continuation result, but without the ModuleSpecifier
	return preserveMeta(
		isNodeFactory(compatFactory)
			? compatFactory.updateExportDeclaration(contResult, contResult.decorators, contResult.modifiers, contResult.isTypeOnly, contResult.exportClause, undefined)
			: compatFactory.updateExportDeclaration(contResult, contResult.decorators, contResult.modifiers, contResult.exportClause, undefined, contResult.isTypeOnly),
		contResult,
		options
	);
}
