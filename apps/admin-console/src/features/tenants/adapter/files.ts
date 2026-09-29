// A detached anchor on an object URL saves the bytes as they are, under the
// shell's content security policy, which governs no download.
export function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
