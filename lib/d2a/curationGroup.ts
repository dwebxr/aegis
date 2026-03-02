const STORAGE_KEY = "aegis-curation-groups";
const MAX_GROUPS = 50;

export interface CurationGroup {
  id: string;
  dTag: string;
  name: string;
  description: string;
  topics: string[];
  members: string[];
  ownerPk: string;
  createdAt: number;
  lastSynced: number;
}

export function loadGroups(): CurationGroup[] {
  if (typeof globalThis.localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[curation-group] Failed to parse stored groups:", err);
    return [];
  }
}

function writeStore(groups: CurationGroup[]): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch (err) {
    console.warn("[curation-group] Failed to persist groups:", err);
  }
}

export function saveGroup(group: CurationGroup): void {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === group.id);
  if (idx >= 0) {
    groups[idx] = group;
  } else {
    if (groups.length >= MAX_GROUPS) {
      groups.sort((a, b) => a.createdAt - b.createdAt);
      groups.shift();
    }
    groups.push(group);
  }
  writeStore(groups);
}

export function removeGroup(id: string): void {
  writeStore(loadGroups().filter(g => g.id !== id));
}

export function addMember(groupId: string, pubkey: string): void {
  const groups = loadGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  if (group.members.includes(pubkey)) return;
  group.members.push(pubkey);
  writeStore(groups);
}

export function removeMember(groupId: string, pubkey: string): void {
  const groups = loadGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  group.members = group.members.filter(m => m !== pubkey);
  writeStore(groups);
}
