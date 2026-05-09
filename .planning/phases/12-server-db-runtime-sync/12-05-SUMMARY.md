# 12-05 Summary

- Added `apps/server/app/schedule/cleanup-runtime-events.ts`.
- The cleanup task runs daily at `0 0 3 * * *`.
- It deletes runtime events older than one month in batches and trims each session to its newest 100000 rows.
- The task exits immediately when MySQL is disabled.
