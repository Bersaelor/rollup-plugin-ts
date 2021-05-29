import {TS} from "../../../../../../type/ts";
import {EnsureDeclareModifierTransformerVisitorOptions} from "../ensure-declare-modifier-transformer-visitor-options";
import {ensureHasDeclareModifier, hasDeclareModifier} from "../../../util/modifier-util";
import {preserveMeta} from "../../../util/clone-node-with-meta";

export function visitClassExpression(options: EnsureDeclareModifierTransformerVisitorOptions<TS.ClassExpression>): TS.ClassExpression {
	const {node, typescript, factory} = options;
	if (hasDeclareModifier(node, typescript)) return node;

	return preserveMeta(
		factory.updateClassExpression(
			node,
			node.decorators,
			ensureHasDeclareModifier(node.modifiers, factory, typescript),
			node.name,
			node.typeParameters,
			node.heritageClauses,
			node.members
		),
		node,
		options
	);
}
