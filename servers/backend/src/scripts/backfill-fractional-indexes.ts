import './env-setup';
import { db } from '@prodesk/server-shared/db/index';
import { tasks, projects } from '@prodesk/server-shared/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';

async function main() {
  console.log('Fetching tasks...');
  const allTasks = await db.select().from(tasks).orderBy(sql`${tasks.sortOrder}::numeric ASC`);
  
  // Group tasks by category and assignee
  const tasksByGroup = new Map<string, typeof allTasks>();
  for (const t of allTasks) {
    const key = `${t.assigneeId}_${t.category}`;
    if (!tasksByGroup.has(key)) tasksByGroup.set(key, []);
    tasksByGroup.get(key)!.push(t);
  }

  console.log('Updating tasks with fractional indexes...');
  let taskCount = 0;
  for (const group of tasksByGroup.values()) {
    let currentKey: string | null = null;
    for (const t of group) {
      // Skip if it looks like a valid fractional index (doesn't start with a number or minus sign)
      // Though for safety we can just overwrite all of them to establish a clean baseline
      const nextKey = generateKeyBetween(currentKey, null);
      await db.update(tasks).set({ sortOrder: nextKey }).where(eq(tasks.id, t.id));
      currentKey = nextKey;
      taskCount++;
      if (taskCount % 100 === 0) console.log(`Updated ${taskCount} tasks...`);
    }
  }
  console.log(`Finished updating ${taskCount} tasks.`);

  console.log('Fetching projects...');
  const allProjects = await db.select().from(projects).orderBy(asc(projects.createdAt));

  const projectsByStatus = new Map<string, typeof allProjects>();
  for (const p of allProjects) {
    if (!projectsByStatus.has(p.status)) projectsByStatus.set(p.status, []);
    projectsByStatus.get(p.status)!.push(p);
  }

  console.log('Updating projects with fractional indexes...');
  let projectCount = 0;
  for (const group of projectsByStatus.values()) {
    let currentKey: string | null = null;
    for (const p of group) {
      const nextKey = generateKeyBetween(currentKey, null);
      await db.update(projects).set({ sortOrder: nextKey }).where(eq(projects.id, p.id));
      currentKey = nextKey;
      projectCount++;
      if (projectCount % 100 === 0) console.log(`Updated ${projectCount} projects...`);
    }
  }
  console.log(`Finished updating ${projectCount} projects.`);
  process.exit(0);
}

main().catch(console.error);
