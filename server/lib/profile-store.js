import { readFile } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { paths } from '../config.js';
import {
  BUILT_IN_PROFILE_IDS,
  buildEffectiveProfiles,
  buildUniqueProfileId,
  getBuiltInProfiles,
  normalizeProfile,
  validateNewProfileId,
} from './specs.js';
import { ensureDir, writeJson } from './file-utils.js';

const STORE_FILENAME = 'profiles.json';

export class ProfileStore {
  constructor() {
    this.filePath = path.join(paths.profiles, STORE_FILENAME);
    this.customProfiles = [];
    this.disabledBuiltInIds = new Set();
  }

  async load() {
    await ensureDir(paths.profiles);
    if (!existsSync(this.filePath)) {
      await this.persist();
      return;
    }

    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.customProfiles = Array.isArray(raw.customProfiles)
        ? raw.customProfiles.map(profile => normalizeProfile(profile, { isBuiltIn: false }))
        : [];
      this.disabledBuiltInIds = new Set(Array.isArray(raw.disabledBuiltInIds) ? raw.disabledBuiltInIds : []);
    } catch {
      this.customProfiles = [];
      this.disabledBuiltInIds = new Set();
      await this.persist();
    }
  }

  async persist() {
    await writeJson(this.filePath, {
      customProfiles: this.customProfiles,
      disabledBuiltInIds: Array.from(this.disabledBuiltInIds),
    });
  }

  listBuiltInProfiles() {
    const disabled = this.disabledBuiltInIds;
    return getBuiltInProfiles().map(profile => ({
      ...profile,
      enabled: !disabled.has(profile.id),
    }));
  }

  listProfiles() {
    return buildEffectiveProfiles({
      customProfiles: this.customProfiles,
      disabledBuiltInIds: Array.from(this.disabledBuiltInIds),
    });
  }

  getEnabledProfiles() {
    return this.listProfiles().filter(profile => profile.enabled !== false);
  }

  getProfile(id) {
    return this.listProfiles().find(profile => profile.id === id) || null;
  }

  async createProfile(input = {}) {
    const existingProfiles = this.listProfiles();
    const payload = { ...input };
    if (!payload.id) {
      payload.id = buildUniqueProfileId(payload.label || 'profile', existingProfiles);
    } else {
      payload.id = validateNewProfileId(payload.id, existingProfiles);
    }
    const profile = normalizeProfile(payload, { isBuiltIn: false });
    this.customProfiles.push(profile);
    await this.persist();
    return profile;
  }

  async updateProfile(id, patch = {}) {
    if (BUILT_IN_PROFILE_IDS.includes(id)) {
      if (typeof patch.enabled !== 'boolean') {
        const err = new Error('Built-in profiles are read-only. Duplicate them to customize.');
        err.status = 400;
        throw err;
      }
      if (patch.enabled) this.disabledBuiltInIds.delete(id);
      else this.disabledBuiltInIds.add(id);
      await this.persist();
      return this.getProfile(id);
    }

    const index = this.customProfiles.findIndex(profile => profile.id === id);
    if (index < 0) {
      const err = new Error('Profile not found.');
      err.status = 404;
      throw err;
    }

    const current = this.customProfiles[index];
    const nextId = patch.id && patch.id !== id
      ? validateNewProfileId(patch.id, this.listProfiles().filter(profile => profile.id !== id))
      : id;
    const updated = normalizeProfile({ ...current, ...patch, id: nextId }, { isBuiltIn: false });
    this.customProfiles[index] = updated;
    await this.persist();
    return updated;
  }

  async deleteProfile(id) {
    if (BUILT_IN_PROFILE_IDS.includes(id)) {
      const err = new Error('Built-in profiles cannot be deleted.');
      err.status = 400;
      throw err;
    }

    const index = this.customProfiles.findIndex(profile => profile.id === id);
    if (index < 0) {
      const err = new Error('Profile not found.');
      err.status = 404;
      throw err;
    }

    this.customProfiles.splice(index, 1);
    await this.persist();
  }

  async importProfiles(payload = {}, { replace = false } = {}) {
    const inputProfiles = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.profiles) ? payload.profiles : [];
    const disabledBuiltInIds = Array.isArray(payload.disabledBuiltInIds) ? payload.disabledBuiltInIds : [];
    const existing = replace ? this.listBuiltInProfiles() : this.listProfiles();
    const nextCustomProfiles = replace ? [] : [...this.customProfiles];

    for (const input of inputProfiles) {
      const id = input.id
        ? buildUniqueProfileId(input.id, [...existing, ...nextCustomProfiles])
        : buildUniqueProfileId(input.label || 'profile', [...existing, ...nextCustomProfiles]);
      nextCustomProfiles.push(normalizeProfile({ ...input, id }, { isBuiltIn: false }));
    }

    this.customProfiles = nextCustomProfiles;
    this.disabledBuiltInIds = new Set(disabledBuiltInIds.filter(id => BUILT_IN_PROFILE_IDS.includes(id)));
    await this.persist();
    return this.listProfiles();
  }

  exportProfiles() {
    return {
      customProfiles: this.customProfiles,
      disabledBuiltInIds: Array.from(this.disabledBuiltInIds),
    };
  }
}
