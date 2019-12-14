import {visitNode} from "./visitor/visit-node";
import {TS} from "../../../../../type/ts";
import {ChildVisitResult, IncludeSourceFileOptions, ModuleMergerVisitorOptions, PayloadMap, VisitResult} from "./module-merger-visitor-options";
import {pathsAreEqual} from "../../../../../util/path/path-util";
import {DeclarationTransformer} from "../../declaration-bundler-options";
import {applyTransformers} from "../../util/apply-transformers";
import {getNodePlacementQueue} from "../../util/get-node-placement-queue";
import {ImportedSymbol} from "../source-file-bundler/source-file-bundler-visitor-options";
import {findMatchingImportedSymbol} from "../../util/find-matching-imported-symbol";
import {cloneNodeWithSymbols} from "../../util/clone-node-with-symbols";

export function moduleMerger(...transformers: DeclarationTransformer[]): DeclarationTransformer {
	return options => {
		const nodePlacementQueue = getNodePlacementQueue({typescript: options.typescript});

		// Prepare some VisitorOptions
		const visitorOptions: Omit<ModuleMergerVisitorOptions<TS.Node>, "node"> = {
			...options,
			...nodePlacementQueue,
			transformers,
			payload: undefined,

			childContinuation: <U extends TS.Node>(node: U, payload: PayloadMap[U["kind"]]): ChildVisitResult<U> => {
				visitorOptions.payload = payload;
				return options.typescript.visitEachChild(
					node,
					nextNode =>
						nodePlacementQueue.wrapVisitResult(
							visitNode({
								...visitorOptions,
								node: nextNode
							})
						),
					options.context
				) as ChildVisitResult<U>;
			},

			continuation: <U extends TS.Node>(node: U, payload: PayloadMap[U["kind"]]): VisitResult<U> => {
				visitorOptions.payload = payload;
				return nodePlacementQueue.wrapVisitResult(
					visitNode({
						...visitorOptions,
						node
					} as ModuleMergerVisitorOptions<U>)
				) as VisitResult<U>;
			},

			shouldPreserveImportedSymbol(importedSymbol: ImportedSymbol): boolean {
				let importedSymbols = options.preservedImports.get(importedSymbol.moduleSpecifier);
				if (importedSymbols == null) {
					importedSymbols = new Set();
					options.preservedImports.set(importedSymbol.moduleSpecifier, importedSymbols);
				}

				// Preserve the import of there is no matching imported symbol already
				if (findMatchingImportedSymbol(importedSymbol, importedSymbols) != null) {
					return false;
				}

				// Otherwise, the import should be preserved!
				importedSymbols.add(importedSymbol);
				return true;
			},

			getMatchingSourceFile(moduleSpecifier: string, from: string): TS.SourceFile | undefined {
				const resolverResult = options.resolver(moduleSpecifier, from);
				// If no SourceFile could be resolved
				if (resolverResult == null) return undefined;

				for (const sourceFile of options.otherSourceFiles) {
					if (pathsAreEqual(sourceFile.fileName, resolverResult.fileName)) {
						return sourceFile;
					}
				}

				return undefined;
			},

			includeSourceFile(
				sourceFile: TS.SourceFile,
				{allowDuplicate = false, transformers: extraTransformers = [], ...otherOptions}: Partial<IncludeSourceFileOptions> = {}
			): Iterable<TS.Statement> {
				// Never include the same SourceFile twice
				if (options.includedSourceFiles.has(sourceFile) && !allowDuplicate) return [];
				options.includedSourceFiles.add(sourceFile);

				const transformedSourceFile = applyTransformers({
					visitorOptions: {
						...visitorOptions,
						...otherOptions,
						sourceFile
					},
					transformers: [moduleMerger(...transformers, ...extraTransformers), ...transformers, ...extraTransformers]
				});

				// Keep track of the original symbols which will be lost when the nodes are cloned
				return transformedSourceFile.statements.map(node => cloneNodeWithSymbols({...options, node}));
			}
		};

		return visitorOptions.childContinuation(options.sourceFile, undefined) as TS.SourceFile;
	};
}
