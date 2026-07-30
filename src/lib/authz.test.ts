import { describe, expect, it } from 'vitest';
import { can, roleFor, type Action, type Role } from '@/lib/authz';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const COLLABORATOR_ID = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const doc = { ownerId: OWNER_ID };

describe('roleFor', () => {
  it('calls the user who owns the document the owner', () => {
    expect(roleFor(OWNER_ID, doc, false)).toBe('owner');
  });

  it('still calls the owner the owner even if they also have a share row', () => {
    expect(roleFor(OWNER_ID, doc, true)).toBe('owner');
  });

  it('calls a user with a share row a collaborator', () => {
    expect(roleFor(COLLABORATOR_ID, doc, true)).toBe('collaborator');
  });

  it('calls a signed-in user with no share row a stranger', () => {
    expect(roleFor(STRANGER_ID, doc, false)).toBe('stranger');
  });

  it('calls an anonymous visitor a stranger', () => {
    expect(roleFor(null, doc, false)).toBe('stranger');
  });

  it('calls an anonymous visitor a stranger even if a share row was passed in', () => {
    // Belt and braces: no signed-in user means no access, whatever else is true.
    expect(roleFor(null, doc, true)).toBe('stranger');
  });
});

describe('can — the full role x action matrix', () => {
  // Every cell of the matrix is asserted below. `expected` lists exactly the
  // actions that role may perform; everything else must be denied.
  const matrix: { role: Role; label: string; allowed: Action[] }[] = [
    {
      role: 'owner',
      label: 'an owner',
      allowed: ['read', 'edit', 'rename', 'delete', 'share'],
    },
    { role: 'collaborator', label: 'a collaborator', allowed: ['read', 'edit'] },
    { role: 'stranger', label: 'a stranger', allowed: [] },
  ];

  const allActions: Action[] = ['read', 'edit', 'rename', 'delete', 'share'];

  for (const { role, label, allowed } of matrix) {
    for (const action of allActions) {
      const permitted = allowed.includes(action);
      it(`${label} ${permitted ? 'can' : 'cannot'} ${action} the document`, () => {
        expect(can(role, action)).toBe(permitted);
      });
    }
  }
});

describe('can — the cases that matter most, spelled out', () => {
  it('an owner can delete the document', () => {
    expect(can('owner', 'delete')).toBe(true);
  });

  it('an owner can share the document', () => {
    expect(can('owner', 'share')).toBe(true);
  });

  it('a collaborator can read and edit the document', () => {
    expect(can('collaborator', 'read')).toBe(true);
    expect(can('collaborator', 'edit')).toBe(true);
  });

  it('a collaborator cannot delete the document', () => {
    expect(can('collaborator', 'delete')).toBe(false);
  });

  it('a collaborator cannot rename the document', () => {
    expect(can('collaborator', 'rename')).toBe(false);
  });

  it('a collaborator cannot share the document with anyone else', () => {
    expect(can('collaborator', 'share')).toBe(false);
  });

  it('a stranger cannot even read the document', () => {
    expect(can('stranger', 'read')).toBe(false);
  });

  it("an anonymous visitor gets a stranger's permissions, which is nothing", () => {
    const role = roleFor(null, doc, false);
    expect(allOf(role)).toEqual([]);
  });
});

function allOf(role: Role): Action[] {
  const actions: Action[] = ['read', 'edit', 'rename', 'delete', 'share'];
  return actions.filter((a) => can(role, a));
}
