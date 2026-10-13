import type { XTreeNode } from "../capture-types";
import { formatDate } from "../front-matter";

function compareNodes(a: XTreeNode, b: XTreeNode): number {
  if (a.position !== b.position) {
    return a.position - b.position;
  }
  const dateA = a.postedAt ?? "";
  const dateB = b.postedAt ?? "";
  return dateA.localeCompare(dateB);
}

export function xThreadTitle(nodes: XTreeNode[]): string {
  if (nodes.length === 0) {
    return "Untitled X post";
  }

  const nodeMap = new Map<string, XTreeNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const explicitRoots = nodes.filter((n) => n.parentId === null).sort(compareNodes);
  let root: XTreeNode;
  if (explicitRoots.length > 0) {
    root = explicitRoots[0]!;
  } else {
    const orphanRoots = nodes.filter((n) => !nodeMap.has(n.parentId!)).sort(compareNodes);
    root = orphanRoots.length > 0 ? orphanRoots[0]! : [...nodes].sort(compareNodes)[0]!;
  }

  const cleanHandle = root.handle.replace(/^@/, "");
  if (nodes.length > 1) {
    return `Thread by ${root.authorName} (@${cleanHandle})`;
  }
  return `Post by ${root.authorName} (@${cleanHandle})`;
}

function renderNodeBlock(node: XTreeNode, depth: number): string[] {
  let formattedDate: string | null = null;
  if (node.postedAt) {
    try {
      formattedDate = formatDate(node.postedAt);
    } catch {
      formattedDate = null;
    }
  }

  const cleanHandle = node.handle.replace(/^@/, "");
  const headerText = formattedDate
    ? `**${node.authorName}** (@${cleanHandle}) · ${formattedDate} · [link](${node.postUrl})`
    : `**${node.authorName}** (@${cleanHandle}) · [link](${node.postUrl})`;

  const prefix = "> ".repeat(depth);
  const trimmedPrefix = prefix.trimEnd();

  const lines: string[] = [];
  lines.push(`${prefix}${headerText}`);
  lines.push(trimmedPrefix);

  const textLines = node.text.split(/\r?\n/);
  for (const rawLine of textLines) {
    if (rawLine === "") {
      lines.push(trimmedPrefix);
    } else {
      const escaped = rawLine.startsWith("#") ? `\\${rawLine}` : rawLine;
      lines.push(`${prefix}${escaped}`);
    }
  }

  return lines;
}

export function renderXThreadMarkdown(nodes: XTreeNode[], title: string): string {
  if (nodes.length === 0) {
    return `# ${title}\n`;
  }

  const nodeMap = new Map<string, XTreeNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const roots: XTreeNode[] = [];
  const childrenMap = new Map<string, XTreeNode[]>();

  for (const node of nodes) {
    if (node.parentId === null || !nodeMap.has(node.parentId)) {
      roots.push(node);
    } else {
      const list = childrenMap.get(node.parentId);
      if (list) {
        list.push(node);
      } else {
        childrenMap.set(node.parentId, [node]);
      }
    }
  }

  roots.sort(compareNodes);
  for (const list of childrenMap.values()) {
    list.sort(compareNodes);
  }

  const ordered: { node: XTreeNode; depth: number }[] = [];
  const visited = new Set<string>();

  function traverse(node: XTreeNode, depth: number) {
    if (visited.has(node.id)) {
      return;
    }
    visited.add(node.id);
    ordered.push({ node, depth });
    const children = childrenMap.get(node.id);
    if (children) {
      for (const child of children) {
        traverse(child, depth + 1);
      }
    }
  }

  for (const root of roots) {
    traverse(root, 0);
  }

  // Handle any remaining cyclic nodes that didn't have a parent outside the cycle
  if (visited.size < nodes.length) {
    const unvisited = nodes.filter((n) => !visited.has(n.id)).sort(compareNodes);
    for (const orphan of unvisited) {
      traverse(orphan, 0);
    }
  }

  const lines: string[] = [`# ${title}`, ""];

  for (let i = 0; i < ordered.length; i++) {
    if (i > 0) {
      const sep = "> ".repeat(Math.min(ordered[i - 1]!.depth, ordered[i]!.depth)).trimEnd();
      lines.push(sep);
    }
    const current = ordered[i]!;
    lines.push(...renderNodeBlock(current.node, current.depth));
  }

  return lines.join("\n") + "\n";
}
