# Sift

**Live:** https://orbitmechanic.github.io/sift/

A private, ad-free image board. Search openly licensed images, save only their links, bring your Pinterest boards across, and grow a feed from the things you chose.

Sift is a static site: HTML, CSS, and vanilla JavaScript with no build step, no framework, and no backend.

## Run locally

```sh
python3 -m http.server 8123 -d sift
```

Open `http://localhost:8123`.

## Deploy to GitHub Pages

### Dedicated repository (recommended)

1. Push the contents of this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)`, then save.

The site will be available at `https://<user>.github.io/<repo>/`.

### From this monorepo

Commit `sift/` to the repository, enable GitHub Pages for the `main` branch at the repository root, and open:

```text
https://orbitmechanic.github.io/last-project/sift/
```

Sift uses relative asset paths, so it works from a project subpath without configuration. The `sift/.nojekyll` file only matters when this folder is the Pages root.

To publish only this folder to a `gh-pages` branch instead:

```sh
git subtree push --prefix sift origin gh-pages
```

Then set Pages to deploy from the `gh-pages` branch.

## What it stores

Everything is local to the browser. The archive is saved under the `localStorage` key `sift.v1`:

```json
{
  "version": 1,
  "boards": [
    {
      "id": "board-id",
      "name": "Moss Study",
      "createdAt": "2026-10-24T12:00:00.000Z",
      "updatedAt": "2026-10-24T12:00:00.000Z",
      "seeds": ["mossy forest"],
      "pins": [
        {
          "url": "https://example.org/image.jpg",
          "thumb": "https://example.org/thumb.jpg",
          "title": "Mossy forest",
          "creator": "Example",
          "license": "CC BY",
          "source": "flickr",
          "provider": "openverse",
          "foreignLandingUrl": "https://example.org/source-page",
          "width": 1024,
          "height": 685,
          "tags": ["forest", "moss"],
          "savedAt": "2026-10-24T12:01:00.000Z"
        }
      ]
    }
  ],
  "prefs": {
    "theme": "auto"
  }
}
```

Pins contain image URLs and small metadata. Sift never downloads image files into the archive and never stores base64 image data. The `provider` field is one of `openverse`, `wikimedia`, `pinterest`, or `manual`.

Boards imported from Pinterest also carry an optional origin, used to recognize the same board on a later import:

```json
"origin": {
  "provider": "pinterest",
  "boardId": "424605139808106786",
  "username": "pinterest"
}
```

## Pinterest import

Pinterest does not allow a static site to read its boards directly. Sift uses a bookmarklet instead: a small, user-installed bookmark that runs inside your Pinterest tab, reads the boards your browser session can see, and passes them to Sift.

1. Open **Pinterest** in Sift's sidebar and enter the Pinterest username.
2. Drag **Sift Pinterest Importer** to your bookmarks bar (or use **Copy** and paste it as a bookmark's URL).
3. Open Pinterest. Sign in first for private boards and the fullest public feeds.
4. Click the importer in your bookmarks bar.
5. Sift opens a preview. Choose the boards to keep, then click **Import selected**.

Public boards work without signing in, but Pinterest may return only a preview of each board to anonymous sessions; Sift shows a warning when that happens. Sign in to Pinterest for complete public imports. Private boards appear only when the username belongs to the account signed in to Pinterest in that browser; Sift cannot access another account's private boards.

The importer:

- Reads the board list and every page of each board's pins.
- Merges into an existing board with the same Pinterest origin, then the same name.
- Skips image links that are already on the board.
- Caps imports at 200 boards and 5,000 links per board. The preview lets you deselect boards if the archive is too large for this browser's storage.
- Sends normalized data directly to the Sift tab with `postMessage`, guarded by a one-time token and a Pinterest origin check. No Sift server, Pinterest password, or Pinterest cookie is involved.

Pinterest's internal web endpoints are unofficial and may change. If an import stops working, Pinterest may have changed its response format or blocked the request.

## Privacy

- No accounts, analytics, cookies, tracking pixels, or third-party scripts.
- Search queries are sent directly from the browser to Openverse, with Wikimedia Commons as a fallback.
- Search history stays in memory only and is discarded on reload.
- Images load from their original hosts. Those hosts can see your IP address; `no-referrer` prevents them from receiving the page URL.
- Pinterest import is optional and stays in the browser. The bookmarklet reads Pinterest using your current Pinterest session and hands normalized data to Sift; Sift never receives your Pinterest credentials.
- Export your boards as JSON at any time. Erasing site data removes the archive permanently.

## Image sources

- [Openverse](https://openverse.org) is the primary search source.
- [Wikimedia Commons](https://commons.wikimedia.org) is the fallback.
- Related images use Openverse's related-image endpoint when an Openverse image ID is available.
- Pinterest imports only image URLs and metadata from pins. Sift does not grant rights to those images; check the original pin before reusing one.

Openverse anonymous API limits apply (currently 20 requests per minute and 200 per day, with a separate thumbnail limit). If Openverse is unavailable or rate-limited, Sift falls back to Wikimedia Commons. Check the license on each original source page before reusing an image.

## Files

- `index.html` — app shell, dialogs, icons, CSP, and metadata.
- `styles.css` — layout, themes, cards, masonry, dialogs, and responsive styles.
- `app.js` — state, API calls, feed logic, rendering, persistence, and interactions.
- `assets/fonts/` — self-hosted Fraunces and Instrument Sans subset files.
- `favicon.svg` — site mark.
- `.nojekyll` — bypasses Jekyll when this folder is the Pages root.
