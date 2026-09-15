# Deployment

Promotion path: `development` → `staging` → `main`

**Deploy to staging:**

```bash
git checkout staging
git pull origin staging
git merge origin/development
git push origin staging
git checkout development
```

**Deploy to production:**

```bash
git checkout staging && git pull origin staging && git merge origin/development && git push origin staging
git checkout main && git pull origin main && git merge origin/staging && git push origin main
git checkout development
```
