import { extractWorkspace } from './workspaceUtils';

describe('extractWorkspace', () => {
  it('should extract workspace name from valid path', () => {
    expect(extractWorkspace('/Users/alan/Documents/codes/multisoul')).toBe('multisoul');
    expect(extractWorkspace('/home/user/projects/my-app')).toBe('my-app');
  });

  it('should return null for empty or invalid paths', () => {
    expect(extractWorkspace('')).toBeNull();
    expect(extractWorkspace('   ')).toBeNull();
    expect(extractWorkspace('/')).toBeNull();
  });

  it('should handle paths with trailing slashes', () => {
    expect(extractWorkspace('/Users/alan/codes/multisoul/')).toBe('multisoul');
    expect(extractWorkspace('/home/user/projects/my-app///')).toBe('my-app');
  });

  it('should handle Windows-style paths', () => {
    expect(extractWorkspace('C:\\Users\\alan\\codes\\multisoul')).toBe('multisoul');
  });
});
