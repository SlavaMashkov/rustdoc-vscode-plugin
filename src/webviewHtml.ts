import template from "./webview.html";

const BODY_PLACEHOLDER = "{{BODY}}";

/** Generate the complete HTML document for the webview panel */
export function wrapHtml(body: string): string {
  return template.replace(BODY_PLACEHOLDER, body);
}
