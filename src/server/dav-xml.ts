// A small, strict XML reader for CalDAV (WebDAV multistatus) answers. Names are matched without their
// namespace prefix. DOCTYPE and entity declarations are refused outright (no entity expansion, so no
// "billion laughs"), and depth and node counts are capped.
export type XNode = { name: string; text: string; children: XNode[]; attrs: Record<string, string> };

const MAX_DEPTH = 40;
const MAX_NODES = 200_000;
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]!.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 8 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const local = (qname: string) => qname.slice(qname.indexOf(":") + 1);

export function parseXml(source: string): XNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("XML with a DOCTYPE is not accepted");
  const root: XNode = { name: "#root", text: "", children: [], attrs: {} };
  const stack: XNode[] = [root];
  let nodes = 0;
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const upto = lt === -1 ? source.length : lt;
    if (upto > i) stack[stack.length - 1]!.text += decode(source.slice(i, upto));
    if (lt === -1) break;
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("Unterminated XML comment");
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error("Unterminated CDATA");
      stack[stack.length - 1]!.text += source.slice(lt + 9, end);
      i = end + 3;
    } else if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      if (end < 0) throw new Error("Unterminated XML declaration");
      i = end + 2;
    } else if (source.startsWith("</", lt)) {
      const end = source.indexOf(">", lt + 2);
      if (end < 0) throw new Error("Unterminated closing tag");
      if (stack.length <= 1 || stack[stack.length - 1]!.name !== local(source.slice(lt + 2, end).trim())) throw new Error("Mismatched XML tags");
      stack.pop();
      i = end + 1;
    } else {
      // an opening tag; attribute values may contain ">", so scan quotes
      let j = lt + 1;
      let quote = "";
      while (j < source.length) {
        const ch = source[j]!;
        if (quote) {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
        j += 1;
      }
      if (j >= source.length) throw new Error("Unterminated tag");
      const inner = source.slice(lt + 1, j);
      const selfClosing = inner.endsWith("/");
      const name = local(/^[^\s/]+/.exec(inner)?.[0] ?? "");
      if (!name) throw new Error("Empty tag name");
      nodes += 1;
      if (nodes > MAX_NODES) throw new Error("XML is too large");
      const attrs: Record<string, string> = {};
      for (const m of inner.slice(name.length).matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[local(m[1]!)] = decode(m[3] ?? m[4] ?? "");
      const node: XNode = { name, text: "", children: [], attrs };
      stack[stack.length - 1]!.children.push(node);
      if (!selfClosing) {
        if (stack.length > MAX_DEPTH) throw new Error("XML is nested too deeply");
        stack.push(node);
      }
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error("Unclosed XML tags");
  const top = root.children[0];
  if (!top) throw new Error("Empty XML");
  return top;
}

export const kids = (node: XNode | undefined, name: string): XNode[] => (node ? node.children.filter((c) => c.name === name) : []);
export const kid = (node: XNode | undefined, name: string): XNode | undefined => kids(node, name)[0];
export function all(node: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
}
/** Text of a descendant path such as ("prop", "displayname"). */
export function textAt(node: XNode | undefined, ...path: string[]): string | undefined {
  let cur = node;
  for (const step of path) cur = kid(cur, step);
  const t = cur?.text.trim();
  return t ? t : undefined;
}
