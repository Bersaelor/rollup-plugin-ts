import {isBabelPluginTransformRuntime, isBabelPresetEnv, isYearlyBabelPreset, somePathsAreRelated} from "../path/path-util";
import {
	BABEL_MINIFICATION_BLACKLIST_PLUGIN_NAMES,
	BABEL_MINIFICATION_BLACKLIST_PRESET_NAMES,
	BABEL_MINIFY_PLUGIN_NAMES,
	BABEL_MINIFY_PRESET_NAMES,
	FORCED_BABEL_PLUGIN_TRANSFORM_RUNTIME_OPTIONS,
	FORCED_BABEL_PRESET_ENV_OPTIONS,
	FORCED_BABEL_YEARLY_PRESET_OPTIONS
} from "../../constant/constant";
import {GetBabelConfigOptions} from "./get-babel-config-options";
import {BabelConfigFactory, FullConfig} from "./get-babel-config-result";
import {TypescriptPluginBabelOptions} from "../../plugin/typescript-plugin-options";
import {isDefined} from "../is-defined/is-defined";
import type {ConfigItem, TransformOptions} from "@babel/core";

/**
 * Returns true if the given babelConfig is IBabelInputOptions
 */
function isBabelInputOptions(babelConfig?: TypescriptPluginBabelOptions["babelConfig"]): babelConfig is Partial<TransformOptions> {
	return babelConfig != null && typeof babelConfig !== "string";
}

/**
 * Combines the given two sets of presets
 */
function combineConfigItems(userItems: ConfigItem[], defaultItems: ConfigItem[] = [], forcedItems: ConfigItem[] = [], inChunkPhase: boolean): ConfigItem[] {
	const namesInUserItems = new Set(userItems.map(item => item.file?.resolved).filter(isDefined));
	const namesInForcedItems = new Set(forcedItems.map(item => item.file?.resolved).filter(isDefined));
	const userItemsHasYearlyPreset = [...namesInUserItems].some(isYearlyBabelPreset);

	return (
		[
			// Only use those default items that doesn't appear within the forced items or the user-provided items.
			// If the options contains a yearly preset such as "preset-es2015", filter out preset-env from the default items if it is given
			...defaultItems.filter(
				item =>
					item.file == null ||
					(!somePathsAreRelated(namesInUserItems, item.file.resolved) &&
						!somePathsAreRelated(namesInForcedItems, item.file.resolved) &&
						(!userItemsHasYearlyPreset || !isBabelPresetEnv(item.file.resolved)))
			),

			// Only use those user items that doesn't appear within the forced items
			...userItems.filter(item => item.file == null || !namesInForcedItems.has(item.file.resolved)),

			// Apply the forced items at all times
			...forcedItems
		]
			// Filter out those options that do not apply depending on whether or not to apply minification
			.filter(configItem => (inChunkPhase ? configItemIsAllowedDuringChunkPhase(configItem) : configItemIsAllowedDuringFilePhase(configItem)))
	);
}

/**
 * Returns true if the given configItem is related to minification
 */
function configItemIsRelevantForChunkPhase(configItem: ConfigItem): boolean {
	return (
		BABEL_MINIFY_PRESET_NAMES.some(preset => configItem.file?.resolved.includes(preset)) || BABEL_MINIFY_PLUGIN_NAMES.some(plugin => configItem.file?.resolved.includes(plugin))
	);
}

/**
 * Returns true if the given configItem is allowed per chunk transformation
 */
function configItemIsAllowedDuringChunkPhase(configItem: ConfigItem): boolean {
	return (
		BABEL_MINIFICATION_BLACKLIST_PRESET_NAMES.every(preset => configItem.file == null || !configItem.file.resolved.includes(preset)) &&
		BABEL_MINIFICATION_BLACKLIST_PLUGIN_NAMES.every(plugin => configItem.file == null || !configItem.file.resolved.includes(plugin))
	);
}

/**
 * Returns true if the given configItem is allowed per file transformations
 */
function configItemIsAllowedDuringFilePhase(configItem: ConfigItem): boolean {
	return (
		BABEL_MINIFY_PRESET_NAMES.every(preset => configItem.file == null || !configItem.file.resolved.includes(preset)) &&
		BABEL_MINIFY_PLUGIN_NAMES.every(plugin => configItem.file == null || !configItem.file.resolved.includes(plugin))
	);
}

/**
 * Gets a Babel Config based on the given options
 */
export function getBabelConfig({babel, babelConfig, cwd, forcedOptions = {}, defaultOptions = {}, browserslist, phase, hook}: GetBabelConfigOptions): BabelConfigFactory {
	return (filename: string) => {
		// Load a partial Babel config based on the input options
		const partialConfig = babel.loadPartialConfig(
			// If babel options are provided directly
			isBabelInputOptions(babelConfig)
				? // If the given babelConfig is an object of input options, use that as the basis for the full config
				  {cwd, root: cwd, ...babelConfig}
				: // Load the path to a babel config provided to the plugin if any, otherwise try to resolve it
				  {
						cwd,
						root: cwd,
						filename,
						...(babelConfig == null ? {} : {configFile: babelConfig})
				  }
		);

		if (partialConfig == null) {
			return {
				config: undefined
			};
		}

		const {options} = partialConfig;
		const {presets: forcedPresets, plugins: forcedPlugins, ...otherForcedOptions} = forcedOptions;
		const {presets: defaultPresets, plugins: defaultPlugins, ...otherDefaultOptions} = defaultOptions;
		const configFileOption: TransformOptions = {configFile: false, babelrc: false};

		// If users have provided presets of their own, ensure that they are using respecting the forced options
		if (options.presets != null) {
			options.presets = (options.presets as ConfigItem[]).map(preset => {
				if (preset.file == null) return preset;

				// Apply the forced @babel/preset-env options here
				if (isBabelPresetEnv(preset.file.resolved)) {
					return babel.createConfigItem(
						[
							preset.file.request,
							{
								...(preset.options == null ? {} : preset.options),
								...FORCED_BABEL_PRESET_ENV_OPTIONS,
								// If targets have already been provided by the user options, accept them.
								// Otherwise, apply the browserslist as the preset-env target
								...(preset.options != null && (preset.options as {targets?: unknown}).targets != null
									? {}
									: {
											targets: {
												browsers: browserslist
											}
									  })
							}
						],
						{type: "preset", dirname: cwd}
					);
				}

				// Apply the forced @babel/preset-es[2015|2016|2017...] options here
				else if (isYearlyBabelPreset(preset.file.resolved)) {
					return babel.createConfigItem(
						[
							preset.file.request,
							{
								...(preset.options == null ? {} : preset.options),
								...FORCED_BABEL_YEARLY_PRESET_OPTIONS
							}
						],
						{type: "preset", dirname: cwd}
					);
				}

				return preset;
			});
		}

		// If users have provided plugins of their own, ensure that they are using respecting the forced options
		if (options.plugins != null) {
			options.plugins = (options.plugins as ConfigItem[]).map((plugin: ConfigItem) => {
				if (plugin.file == null) return plugin;

				// Apply the forced @babel/preset-env options here
				if (isBabelPluginTransformRuntime(plugin.file.resolved)) {
					return babel.createConfigItem(
						[
							plugin.file.request,
							{
								...(plugin.options == null ? {} : plugin.options),
								...FORCED_BABEL_PLUGIN_TRANSFORM_RUNTIME_OPTIONS
							}
						],
						{type: "plugin", dirname: cwd}
					);
				}

				return plugin;
			});
		}

		// Combine the partial config with the default and forced options
		const combined: TransformOptions = {
			...otherDefaultOptions,
			...options,
			...otherForcedOptions,
			presets: combineConfigItems(
				(options.presets ?? []) as ConfigItem[],
				defaultPresets == null ? undefined : (babel.loadPartialConfig({presets: defaultPresets, ...configFileOption})?.options.presets as ConfigItem[] | null) ?? undefined,
				forcedPresets == null
					? undefined
					: (babel.loadPartialConfig({presets: forcedPresets, ...configFileOption})?.options.presets as ConfigItem[] | null | undefined) ?? undefined,
				phase === "chunk"
			),
			plugins: combineConfigItems(
				(options.plugins ?? []) as ConfigItem[],
				defaultPlugins == null ? undefined : (babel.loadPartialConfig({plugins: defaultPlugins, ...configFileOption})?.options.plugins as ConfigItem[] | null) ?? undefined,
				forcedPlugins == null
					? undefined
					: (babel.loadPartialConfig({plugins: forcedPlugins, ...configFileOption})?.options.plugins as ConfigItem[] | null | undefined) ?? undefined,
				phase === "chunk"
			)
		};

		// sourceMap is an alias for 'sourceMaps'. If the user provided it, make sure it is undefined. Otherwise, Babel will fail during validation
		if ("sourceMap" in (combined as {sourceMap?: unknown})) {
			delete (combined as {sourceMap?: unknown}).sourceMap;
		}

		const combinedOptionsAfterHook = hook != null ? hook(combined, partialConfig.config ?? partialConfig.babelrc ?? undefined, phase) : combined;

		const loadedOptions = (babel.loadOptions({...combinedOptionsAfterHook, filename, ...configFileOption}) as FullConfig | null) ?? undefined;

		// Only return a config in the chunk phase if it includes at least one plugin or preset that is relevant to it
		if (phase === "chunk") {
			const hasRelevantConfigItems =
				loadedOptions != null &&
				[
					...((combined.plugins as ConfigItem[]) ?? []).filter(configItemIsRelevantForChunkPhase),
					...((combined.presets as ConfigItem[]) ?? []).filter(configItemIsRelevantForChunkPhase)
				].length > 0;
			return {
				config: hasRelevantConfigItems ? loadedOptions : undefined
			};
		} else {
			return {
				config: loadedOptions
			};
		}
	};
}
