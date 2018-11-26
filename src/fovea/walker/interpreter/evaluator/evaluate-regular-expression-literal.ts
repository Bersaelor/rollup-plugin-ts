import {IEvaluatorOptions} from "./i-evaluator-options";
import {RegularExpressionLiteral} from "typescript";
import {Literal} from "../literal/literal";

/**
 * Evaluates, or attempts to evaluate, a RegularExpressionLiteral
 * @param {IEvaluatorOptions<RegularExpressionLiteral>} options
 * @returns {Literal}
 */
export function evaluateRegularExpressionLiteral ({node}: IEvaluatorOptions<RegularExpressionLiteral>): Literal {
	return new Function(`return ${node.text}`)();
}