# echo — Personal Workspace App

A premium deep-navy workspace combining a **Corporate Diary** and a **DigiLocker**, built in React with Supabase as the backend.

---

## Quick Setup (5 minutes)

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com) → New Project → choose a name and password.

### 2. Run the database setup
In your Supabase project → **SQL Editor** → paste the contents of `echo-supabase-setup.sql` → Run.

### 3. Create the storage bucket
Supabase Dashboard → **Storage** → **New bucket**
- Name: `echo-documents`
- Toggle **Public bucket** ON
- Click Create

### 4. Get your credentials
Supabase Dashboard → **Project Settings** → **API**
- Copy **Project URL** → paste as `SUPABASE_URL`
- Copy **anon / public key** → paste as `SUPABASE_ANON_KEY`

### 5. Paste credentials into the app
Open `echo-app.jsx`, find lines 8–9 and replace:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJ...";
```

### 6. Use in your React project
```bash
# If starting fresh
npx create-react-app echo
cd echo
cp echo-app.jsx src/App.jsx
npm start
```

Or drop `echo-app.jsx` into any existing React project as a component.

---

## Features

### Corporate Diary
- Log daily work entries with date, title, ticket number
- 5 mood/status indicators (Productive, Resolved, Challenged, Frustrated, Collaborative)
- Free-text feedback and detailed notes
- Custom tags per entry
- Full-text search across titles, ticket numbers, content, tags
- Filter by mood

### DigiLocker
- Upload any file type — PDF, Word, Excel, Images, Archives
- Automatic file type detection with distinct icons
- Categorise documents (Identity, Finance, Legal, Medical, Work, Property, Travel, Education)
- Add descriptions and tags
- Filter by category with quick-filter pill bar
- Direct open/download links from Supabase storage
- File size display

### Dashboard
- Live entry and document counts
- 4 stat cards
- Recent diary entries preview
- Recent documents preview
- Personalised greeting by time of day

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 (hooks, no external UI lib) |
| Styling | Pure CSS injected at runtime, DM Sans + Playfair Display fonts |
| Backend | Supabase (Postgres + Storage) via direct REST API |
| No build deps | Zero npm packages needed beyond React itself |

---

## Theme
Deep navy / midnight palette with blue accent (#4f8ef7), gold ticket highlights, teal document accents.
Fonts: Playfair Display (logo) + DM Sans (UI) + DM Mono (numbers/dates).
