import { type Loss, lossText, type Asked } from '#/shared/service/capabilities.ts';

export function moveConfirmation(path: string, loss: Loss): Asked {
  return {
    title: 'Move a group your own access runs through?',
    consequence: `${path} would no longer receive what the groups above it hand down.${lossText(loss, 'the groups above it')}`,
  };
}

export function deleteConsequence(path: string, loss: Loss): string {
  return `Deleting ${path} deletes every group beneath it too, with every membership and role mapping of each, so their members lose the roles these groups gave them. It cannot be undone.${lossText(loss, 'these groups')}`;
}

export function subtreeDeletedText(path: string): string {
  return `${path} and every group beneath it were deleted.`;
}

export function rolesConfirmation(path: string, loss: Loss): Asked {
  return {
    title: 'Take roles your own access runs through?',
    consequence: `Taking them off the group takes them from its members.${lossText(loss, path)} You may not be able to give it back yourself.`,
  };
}
