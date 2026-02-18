import { SgNode, type Edit } from "@ast-grep/napi";

export type CodemodRoot = {
  root(): SgNode;
  filename(): string;
};

export type SubTransform = (root: CodemodRoot) => Promise<Edit[] | null>;

export type CodemodTransform = (
  root: CodemodRoot,
  options?: unknown,
) => Promise<string | null>;
