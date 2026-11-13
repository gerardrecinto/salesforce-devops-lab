# Security Policy

Report a vulnerability by email to gerardrecinto@gmail.com. Please do not open a public issue.

Include what you found, how to reproduce it and the impact. Reports get a reply within 48 hours.

Never commit a JWT private key, a connected app secret or an auth URL. The workflows read them from repository secrets and delete the key file after each run. Gitleaks runs on every push.
