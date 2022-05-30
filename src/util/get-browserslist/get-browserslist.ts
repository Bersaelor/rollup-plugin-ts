import {GetBrowserslistOptions} from "./get-browserslist-options.js";
import {normalizeBrowserslist} from "browserslist-generator";
import {ensureAbsolute} from "../path/path-util.js";
import browserslistModule from "browserslist";
import {BrowserslistPathConfig, BrowserslistQueryConfig} from "../../plugin/typescript-plugin-options.js";
import {ensureArray} from "../ensure-array/ensure-array.js";
import path from "crosspath";

/**
 * Returns true if the given browserslist is raw input for a Browserslist
 */
function isBrowserslistInput(browserslist: GetBrowserslistOptions["browserslist"]): browserslist is string[] | string {
	return typeof browserslist === "string" || Array.isArray(browserslist);
}

/**
 * Returns true if the given browserslist is an IBrowserslistQueryConfig
 */
function isBrowserslistQueryConfig(browserslist: GetBrowserslistOptions["browserslist"]): browserslist is BrowserslistQueryConfig {
	return browserslist != null && !isBrowserslistInput(browserslist) && browserslist !== false && "query" in browserslist && browserslist.query != null;
}

/**
 * Returns true if the given browserslist is an IBrowserslistPathConfig
 */
function isBrowserslistPathConfig(browserslist: GetBrowserslistOptions["browserslist"]): browserslist is BrowserslistPathConfig {
	return browserslist != null && !isBrowserslistInput(browserslist) && browserslist !== false && "path" in browserslist && browserslist.path != null;
}

/**
 * Gets a Browserslist based on the given options
 */
export function getBrowserslist({browserslist, cwd, fileSystem}: GetBrowserslistOptions): string[] | false | undefined {
	// If a Browserslist is provided directly from the options, use that
	if (browserslist != null) {
		// If the Browserslist is equal to false, it should never be used. Return undefined
		if (browserslist === false) {
			return false;
		}

		// If the Browserslist is some raw input queries, use them directly
		else if (isBrowserslistInput(browserslist)) {
			return normalizeBrowserslist(ensureArray(browserslist));
		}

		// If the Browserslist is a config with raw query options, use them directly
		else if (isBrowserslistQueryConfig(browserslist)) {
			return normalizeBrowserslist(ensureArray(browserslist.query));
		}

		// If the Browserslist is a config with a path, attempt to resolve the Browserslist from that property
		else if (isBrowserslistPathConfig(browserslist)) {
			const browserslistPath = ensureAbsolute(cwd, browserslist.path);
			const errorMessage = `The given path for a Browserslist: '${browserslistPath}' could not be resolved from '${cwd}'`;

			if (!fileSystem.fileExists(path.native.normalize(browserslistPath))) {
				throw new ReferenceError(errorMessage);
			} else {
				// Read the config
				const match = browserslistModule.readConfig(browserslistPath);
				if (match == null) {
					throw new ReferenceError(errorMessage);
				} else {
					return match.defaults;
				}
			}
		}

		// The config object could not be validated. Return undefined
		else {
			return undefined;
		}
	}

	// Otherwise, try to locate a Browserslist
	else {
		const config = browserslistModule.findConfig(cwd);
		return config == null ? undefined : config.defaults;
	}
}
