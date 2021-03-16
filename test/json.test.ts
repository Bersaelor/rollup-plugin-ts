import test from "ava";
import {withTypeScript} from "./util/ts-macro";
import {generateRollupBundle} from "./setup/setup-rollup";
import json from "@rollup/plugin-json";
import {formatCode} from "./util/format-code";

test("Handles .JSON files that has been pre-transformed by other plugins. #1", withTypeScript, async (t, {typescript}) => {
	const bundle = await generateRollupBundle(
		[
			{
				entry: true,
				fileName: "index.ts",
				text: `\
					import {name} from "./foo.json";
					console.log(name);
					`
			},
			{
				entry: false,
				fileName: "foo.json",
				text: `\
					{
						"name": "Foo"
					}
					`
			}
		],
		{
			typescript,
			debug: false,
			prePlugins: [json()],
			tsconfig: {
				resolveJsonModule: true
			}
		}
	);
	const {
		js: [file]
	} = bundle;
	t.deepEqual(
		formatCode(file.code),
		formatCode(`\
		var name = "Foo";

		console.log(name);
		`)
	);
});
