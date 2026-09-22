// @ts-nocheck (bun:test types are not configured in tsconfig — project test convention)
// Unit tests for the hand-rolled Markdown renderer — focused on GFM
// pipe-table support plus the safety invariants (HTML escaping, URL scheme
// allowlist) that must keep holding inside table cells.
import { describe, test, expect } from "bun:test";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown — GFM pipe tables", () => {
  test("renders a header + separator + body rows as a table", () => {
    const html = renderMarkdown(
      "| Name | Age |\n| --- | --- |\n| Ann | 7 |\n| Bob | 12 |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead><tr>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<th>Age</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>Ann</td>");
    expect(html).toContain("<td>Bob</td>");
    expect(html).toContain("</tbody></table>");
  });

  test("works without leading/trailing framing pipes", () => {
    const html = renderMarkdown("a | b\n--- | ---\n1 | 2");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
  });

  test("separator alignment colons map to text-align styles", () => {
    const html = renderMarkdown("| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |");
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:center">b</th>');
    expect(html).toContain('<th style="text-align:right">c</th>');
    expect(html).toContain('<td style="text-align:center">2</td>');
  });

  test("escaped pipes stay inside the cell", () => {
    const html = renderMarkdown("| a \\| b | c |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<th>a | b</th>");
    expect(html).toContain("<th>c</th>");
  });

  test("inline formatting applies inside cells", () => {
    const html = renderMarkdown("| t |\n| - |\n| **bold** `code` ~~del~~ |");
    expect(html).toContain("<td><strong>bold</strong> <code>code</code> <del>del</del></td>");
  });

  test("rows shorter than the header are padded; longer rows truncated", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 |\n| 2 | 3 | 4 |");
    expect(html).toContain("<tr><td>1</td><td></td></tr>");
    expect(html).toContain("<tr><td>2</td><td>3</td></tr>");
    expect(html).not.toContain("<td>4</td>");
  });

  test("table ends at a blank line or a line without a pipe", () => {
    const html = renderMarkdown("| a |\n| - |\n| 1 |\n\nafter | pipes are prose");
    expect(html).toContain("</table>");
    expect(html).toContain("<p>after | pipes are prose</p>");
  });

  test("a pipe line without a valid separator row is just a paragraph", () => {
    const html = renderMarkdown("a | b\nnot-a-separator\n1 | 2");
    expect(html).not.toContain("<table>");
    expect(html).toContain("<p>a | b");
  });

  test("separator row must contain dashes", () => {
    const html = renderMarkdown("| a |\n| : |\n| 1 |");
    expect(html).not.toContain("<table>");
  });

  test("cell content is HTML-escaped", () => {
    const html = renderMarkdown("| a |\n| - |\n| <script>alert(1)</script> |");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("javascript: link URLs in cells are dropped (scheme allowlist)", () => {
    const html = renderMarkdown("| a |\n| - |\n| [x](javascript:evil) |");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<td>x</td>");
  });

  test("tables around headings and lists keep surrounding block structure", () => {
    const html = renderMarkdown("# Head\n\n| a |\n| - |\n| 1 |\n\n- item");
    expect(html).toContain("<h1>Head</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<ul><li>item</li></ul>");
  });

});

describe("renderMarkdownDocument — table styling", () => {
  test("iframe document includes table/th/td CSS", async () => {
    const { renderMarkdownDocument } = await import("./markdown");
    const doc = renderMarkdownDocument("| a |\n| - |\n| 1 |");
    expect(doc).toContain("table { border-collapse: collapse");
    expect(doc).toContain("th, td { border: 1px solid");
    expect(doc).toContain("<table>");
  });
});
