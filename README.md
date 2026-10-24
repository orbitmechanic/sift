# Sift

A private, ad-free image board. Search openly licensed images, save only their links, and grow a feed from the things you chose.

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

Pins contain image URLs and small metadata. Sift never downloads image files into the archive and never stores base64 image data.

## Privacy

- No accounts, analytics, cookies, tracking pixels, or third-party scripts.
- Search queries are sent directly from the browser to Openverse, with Wikimedia Commons as a fallback.
- Search history stays in memory only and is discarded on reload.
- Images load from their original hosts. Those hosts can see your IP address; `no-referrer` prevents them from receiving the page URL.
- Export your boards as JSON at any time. Erasing site data removes the archive permanently.

## Image sources

- [Openverse](https://openverse.org) is the primary search source.
- [Wikimedia Commons](https://commons.wikimedia.org) is the fallback.
- Related images use Openverse's related-image endpoint when an Openverse image ID is available.

Openverse anonymous API limits apply (currently 20 requests per minute and 200 per day, with a separate thumbnail limit). If Openverse is unavailable or rate-limited, Sift falls back to Wikimedia Commons. Check the license on each original source page before reusing an image.

## Files

- `index.html` — app shell, dialogs, icons, CSP, and metadata.
- `styles.css` — layout, themes, cards, masonry, dialogs, and responsive styles.
- `app.js` — state, API calls, feed logic, rendering, persistence, and interactions.
- `assets/fonts/` — self-hosted Fraunces and Instrument Sans subset files.
- `favicon.svg` — site mark.
- `.nojekyll` — bypasses Jekyll when this folder is the Pages root.
