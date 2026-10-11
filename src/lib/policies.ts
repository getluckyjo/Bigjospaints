/** Owner-approved policies: one Markdown file per policy in src/content/policies/. No file, no page. */
interface PolicyModule {
  frontmatter: { title: string; order?: number; updated?: string };
  Content: any;
}

const files = import.meta.glob<PolicyModule>('../content/policies/*.md', { eager: true });

export const policies = Object.entries(files)
  .map(([file, mod]) => ({
    slug: file.split('/').pop()!.replace(/\.md$/, ''),
    title: mod.frontmatter.title,
    order: mod.frontmatter.order ?? 99,
    updated: mod.frontmatter.updated,
    Content: mod.Content,
  }))
  .sort((a, b) => a.order - b.order);
