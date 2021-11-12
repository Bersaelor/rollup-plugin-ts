declare module "@rollup/plugin-alias" {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export default function alias(...args: any[]): any;
}

declare module "@rollup/plugin-multi-entry" {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export default function multiEntry(...args: any[]): any;
}

declare module "browserslist" {
	export function findConfig(cwd: string): {defaults: string[]} | undefined;
	export function readConfig(path: string): {defaults: string[]} | undefined;
}

declare module "@babel/preset-env" {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export default function multiEntry(...args: any[]): any;
}
