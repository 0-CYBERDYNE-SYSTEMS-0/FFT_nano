import path from 'path';

function isDotSegmentSlug(slug: string): boolean {
  return /^\.+$/.test(slug);
}

export function resolveCoderProjectWorkspace(params: {
  mainWorkspaceDir: string;
  slug: string;
}): string {
  const slug = params.slug.trim();
  if (!slug) {
    throw new Error('Project slug is required.');
  }
  if (isDotSegmentSlug(slug)) {
    throw new Error('Project slug cannot be "." or ".." or dot-only.');
  }

  const projectsRoot = path.resolve(
    params.mainWorkspaceDir,
    'workspace',
    'projects',
  );
  const workspaceRoot = path.resolve(projectsRoot, slug);
  const relative = path.relative(projectsRoot, workspaceRoot);
  if (
    relative === '' ||
    relative === '.' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..'
  ) {
    throw new Error('Project slug resolves outside workspace/projects.');
  }

  return workspaceRoot;
}
