import {ModuleMergerVisitorOptions, VisitResult} from "../module-merger-visitor-options";
import {TS} from "../../../../../../type/ts";
import {createAliasedBinding} from "../../../util/create-aliased-binding";
import {getImportedSymbolFromImportSpecifier} from "../../../util/create-export-specifier-from-name-and-modifiers";
import {locateExportedSymbolForSourceFile} from "../../../util/locate-exported-symbol";
import {generateModuleSpecifier} from "../../../util/generate-module-specifier";
import {getAliasedDeclaration} from "../../../util/get-aliased-declaration";
import {preserveParents} from "../../../util/clone-node-with-meta";
import { ensureNonreservedWord } from "../../../util/generate-unique-binding";

export function visitImportSpecifier(options: ModuleMergerVisitorOptions<TS.ImportSpecifier>): VisitResult<TS.ImportSpecifier> {
	const {node, payload, factory} = options;
	if (payload.moduleSpecifier == null) return options.childContinuation(node, undefined);

	const contResult = options.childContinuation(node, undefined);

	// If no SourceFile was resolved, preserve the ImportSpecifier as-is, unless it is already included in the chunk
	if (payload.matchingSourceFile == null) {
		return options.shouldPreserveImportedSymbol(getImportedSymbolFromImportSpecifier(contResult, payload.moduleSpecifier)) ? contResult : undefined;
	}

	// Otherwise, prepend the nodes for the SourceFile
	options.prependNodes(...options.includeSourceFile(payload.matchingSourceFile));

	const propertyName = contResult.propertyName ?? contResult.name;

	const exportedSymbol =
		propertyName.text === "default"
			? locateExportedSymbolForSourceFile({defaultExport: true}, {...options, sourceFile: payload.matchingSourceFile.fileName})
			: locateExportedSymbolForSourceFile({defaultExport: false, name: propertyName.text}, {...options, sourceFile: payload.matchingSourceFile.fileName});

	if (exportedSymbol != null) {
		// If the export exports a binding from another module *that points to a file that isn't part of the current chunk*,
		// Create a new ImportDeclaration that refers to that chunk or external module
		const generatedModuleSpecifier =
			exportedSymbol.moduleSpecifier == null
				? undefined
				: generateModuleSpecifier({
						...options,
						from: payload.matchingSourceFile.fileName,
						moduleSpecifier: exportedSymbol.moduleSpecifier
				  });
		if (
			exportedSymbol.moduleSpecifier != null &&
			generatedModuleSpecifier != null &&
			options.getMatchingSourceFile(exportedSymbol.moduleSpecifier, payload.matchingSourceFile) == null
		) {
			options.prependNodes(
				preserveParents(
					factory.createImportDeclaration(
						undefined,
						undefined,
						factory.createImportClause(
							false,
							undefined,
							factory.createNamedImports([
								factory.createImportSpecifier(
									false,
									propertyName.text === "default"
										? factory.createIdentifier("default")
										: exportedSymbol.propertyName.text === contResult.name.text
										? undefined
										: factory.createIdentifier(exportedSymbol.propertyName.text),
									factory.createIdentifier(contResult.name.text)
								)
							])
						),
						factory.createStringLiteral(generatedModuleSpecifier)
					),
					options
				)
			);
		} else if (contResult.propertyName != null) {
			const declaration = getAliasedDeclaration({...options, node: contResult.propertyName});
			const safePropertyName = ensureNonreservedWord(exportedSymbol.propertyName.text);
			options.prependNodes(
				...createAliasedBinding({
					...options,
					node: declaration,
					propertyName: safePropertyName,
					name: contResult.name.text
				})
			);
		}
	}

	// Don't include the ImportSpecifier
	return undefined;
}
