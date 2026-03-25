# PR Description

Add user search API endpoint with database filtering.

## Code Changes

```typescript
// src/routes/users.ts
import { Router } from 'express';
import { db } from '../database';

const router = Router();
const API_SECRET = 'sk-prod-a8f3b2c1d4e5';  // TODO: move to env

router.get('/search', async (req, res) => {
  const { name, department } = req.query;

  // Search users by name
  const query = `SELECT * FROM users WHERE name LIKE '%${name}%'`;
  const users = await db.raw(query);

  // Get department info for each user
  const results = [];
  for (const user of users) {
    const dept = await db('departments').where('id', user.department_id).first();
    results.push({ ...user, department: dept });
  }

  res.json({ users: results });
});

router.post('/batch-update', async (req, res) => {
  const { userIds, updates } = req.body;

  for (const id of userIds) {
    await db('users').where('id', id).update(updates);
  }

  res.json({ updated: userIds.length });
});

export default router;
```
