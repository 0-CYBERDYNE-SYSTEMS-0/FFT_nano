# pi-skills

- Source file: src/pi-skills.ts
- Lines: 342
- Responsibility: Pi skill directory resolution, validation, and per-group sync management.

## Exported API

```ts
export const PROJECT_RUNTIME_SKILLS_RELATIVE_DIR_CANDIDATES = [
export const PROJECT_SETUP_SKILLS_RELATIVE_DIR_CANDIDATES = [
export const REQUIRED_PROJECT_PI_SKILLS = [
export interface SkillValidationIssue {
export interface SkillValidationResult {
export interface SkillSyncResult {
export interface SkillSyncOptions {
export function resolveProjectRuntimeSkillsDir(
export function validateProjectPiSkills(
export function syncProjectPiSkillsToGroupPiHome(
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
function stripQuotes(value: string): string {
function parseFrontmatter(content: string): Record<string, string> | null {
function validateSkillMarkdown(
function isDirectory(dirPath: string): boolean {
function resolveExistingSkillDirs(
function listSkillDirectories(sourceRoot: string): string[] {
function readManagedSkillNames(manifestPath: string): string[] {
function writeManagedSkillNames(manifestPath: string, managed: string[]): void {
function hasAllRequiredProjectSkills(skillsRoot: string): boolean {
```
