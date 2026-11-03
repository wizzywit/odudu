export function readFileText(file: File): Promise<string> {
  return file.text();
}
