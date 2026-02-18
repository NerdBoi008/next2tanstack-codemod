import type { Edit } from "@ast-grep/napi";
import type { SubTransform } from "@/types/index.ts";

export const testRules: SubTransform = async (root) => {
  const rootNode = root.root();
  const edits: Edit[] = [];

  console.log({
    currentScannigFile: root.filename(),
  });

  const useServerDirectives = rootNode.findAll({
    rule: {
      any: [
        { pattern: `"use server";`, kind: "expression_statement" },
        { pattern: `'use server';`, kind: "expression_statement" },
        { pattern: `"use server"`, kind: "expression_statement" },
        { pattern: `'use server'`, kind: "expression_statement" },
      ],
    },
  });

  for (const directive of useServerDirectives) {
    edits.push(directive.replace(""));
  }

  return edits.length > 0 ? edits : null;
};
