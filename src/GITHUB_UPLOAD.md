# Upload CampusFind to GitHub

1. Extract `CampusFind_GitHub_Vercel.zip` on your computer.
2. Create a repository at https://github.com/new (for example, `campusfind`).
3. Open PowerShell inside the extracted `CampusFind_GitHub_Vercel` folder.
4. Replace `YOUR_USERNAME` with your GitHub username, then run the commands below. GitHub may open a browser to sign you in.

```powershell
git init
git add .
git commit -m "Prepare CampusFind for Vercel"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/campusfind.git
git push -u origin main
```

5. In Vercel, connect this GitHub repository to the existing CampusFind project. Add the environment variables listed in `README.md`, then deploy.

Never upload a `.env` file, API keys, database passwords, student ID photos, or real campus records to GitHub.
