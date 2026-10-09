export function deleteConsequence(name: string): string {
  return `Deleting ${name} deletes the client and every role scoped to it, with the grants and composite edges that name those roles. An application that signs in through it can no longer do so. It cannot be undone.`;
}

export function deletedText(name: string): string {
  return `${name} was deleted.`;
}
