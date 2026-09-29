// Firefox and Safari can cancel a download whose object URL is revoked as
// soon as it starts, so it is kept a minute.
const KEEP_URL_MS = 60_000;

// An anchor on an object URL saves the bytes as they are, under the shell's
// content security policy, which governs no download. It is in the document
// only for its click, which some browsers ignore on a detached anchor.
export function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, KEEP_URL_MS);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
