# Sift

**Live:** https://orbitmechanic.github.io/sift/

A private, ad-free image board. Search open collections, museums, archives, meme streams, and the wider web; mix a feed that pulls from several threads at once; save only links and metadata; and bring Pinterest boards across. Sift grows from the tags you actually keep.

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

Everything is local to the browser. The archive is saved in IndexedDB (`sift.db`, object store `archive`, key `archive`). A `localStorage` mirror under `sift.v1` is kept for migration and for small archives; when localStorage is full, Sift keeps saving to IndexedDB. The JSON shape is the same in both places:

```json
{
  "version": 2,
  "boards": [
    {
      "id": "board-id",
      "name": "Moss Study",
      "privacy": "public",
      "createdAt": "2026-10-24T12:00:00.000Z",
      "updatedAt": "2026-10-24T12:00:00.000Z",
      "seeds": ["mossy forest"],
      "tags": [
        { "value": "moss", "count": 4, "lastUsedAt": "2026-10-24T12:01:00.000Z" }
      ],
      "pins": [
        {
          "url": "https://example.org/image.jpg",
          "thumb": "https://example.org/thumb.jpg",
          "title": "Mossy forest",
          "creator": "Example",
          "license": "CC BY",
          "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
          "source": "flickr",
          "sourcePage": "https://example.org/source-page",
          "foreignLandingUrl": "https://example.org/source-page",
          "pinUrl": "",
          "domain": "example.org",
          "engine": "",
          "provider": "openverse",
          "description": "Moss on a forest floor.",
          "width": 1024,
          "height": 685,
          "tags": ["forest", "moss"],
          "publishedAt": "2026-10-20T09:00:00.000Z",
          "meta": { "license": "by", "source": "flickr" },
          "savedAt": "2026-10-24T12:01:00.000Z"
        }
      ]
    }
  ],
  "prefs": {
    "theme": "auto",
    "mix": "curious"
  }
}
```

Pins contain image URLs and metadata. Sift never downloads image files into the archive and never stores base64 image data. The `provider` field is one of `openverse`, `wikimedia`, `pinterest`, `manual`, `web`, `artic`, `met`, `vam`, `arena`, `nasa`, `loc`, `archive`, or `meme`. The `mix` preference is `calm`, `curious`, or `wild`.

The archive carries a `savedAt` timestamp so Sift can choose the newer copy when both IndexedDB and the localStorage mirror exist.

A separate `sift.buffer.v1` key holds the displayed-link buffer: links seen in search results, captured web image tabs, or opened pins. It keeps up to 600 sanitized links and is a convenience, not the archive.

Boards imported from Pinterest also carry an optional origin, used to recognize the same board on a later import:

```json
"origin": {
  "provider": "pinterest",
  "boardId": "424605139808106786",
  "username": "pinterest"
}
```

## Tags, Likes, and privacy

- Every saved pin keeps up to 32 normalized tags. Board tags are rebuilt from its pins and ordered by frequency plus recency.
- The default **Likes** board receives quick saves that do not name another board. It cannot be renamed or deleted.
- The field uses the most frequent and recent tags across public boards. Private-board pins and tags are excluded.
- Board pages use their own tag list to suggest more images. A pin's detail view shows an image-tag mini-feed first, then the board-tag mini-feed.
- Mark a board private from its menu. Private boards remain fully usable; they just stay out of the shared feed and global tag profile.

## Home feed and large archives

- The home feed is built from every public board name, board seed, and tag. Private boards stay out of the shared feed and global tag profile.
- Each batch mixes several seeds at once instead of walking one search term to exhaustion. A weighted sampler chooses seeds, sources, and wildcards; `mixImages()` then interleaves the result with penalties for repeating the same source, domain, or tag. One thread never owns the page.
- Three mix modes set how far the feed wanders:
  - **Calm** stays close to your boards and tags, with no wildcards.
  - **Curious** (default) mixes a few wildcards and pulls from more sources per seed.
  - **Wild** pulls harder from memes, random Commons discoveries, and the open web.
- The feed pages through each seed instead of stopping at the first result set. A sentinel near the bottom loads the next batch of 36 unique images as you scroll. Already saved links and recent repeats are skipped. When every reachable seed and page is exhausted, the feed offers **Start a new orbit**.
- Source health is tracked in memory. A failing source gets a short cooldown (45 seconds, longer after rate limits), so one dead API does not stall the whole mix. Feed sources also get a 5-second deadline per batch; search gets 8 seconds per source.
- Board pages and **All saved** render 60 links at a time and load the next 60 when their sentinel comes into view. The full archive stays in state and IndexedDB, so large collections do not have to create every card at once.

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
- Keeps the pin's title, description, creator, Pinterest pin URL, true external source page, domain, dimensions, date, visual tags, interest tags, and rich-summary fields when Pinterest exposes them.
- Caps imports at 200 boards and 5,000 links per board. The preview lets you deselect boards if the archive is too large for this browser's storage.
- Sends normalized boards to the Sift tab one at a time with `postMessage`, so the preview builds up without passing one enormous payload. The hand-off is guarded by a one-time token and a Pinterest origin check. No Sift server, Pinterest password, or Pinterest cookie is involved.

Pinterest's internal web endpoints are unofficial and may change. If an import stops working, Pinterest may have changed its response format or blocked the request.

## Web image capture

Search engines and many art sites do not send `Access-Control-Allow-Origin` for their image results, so a static page cannot fetch them directly. The direct APIs listed below cover the open collections, museums, archives, and meme stream. For everything else, Sift uses a deliberate click.

1. Search in Sift, then choose an engine from the **Capture from anywhere** strip: DuckDuckGo, Bing Images, Google Images, Reddit, Giphy, ArtStation, Are.na, Pinterest, Unsplash, or Pexels.
2. Install the **Absorb image tab** bookmarklet once by dragging it to your bookmarks bar.
3. On the image tab, wait for thumbnails, then click the absorber.
4. Sift opens a receiver, stores every displayed image link and its available metadata, and shows the absorbed set.

The same absorber also works on Brave Search, Qwant, Startpage, Ecosia, Mojeek, Yandex, Flickr, Imgur, Tenor, Tumblr, Bluesky, DeviantArt, Cosmos, 9GAG, Know Your Meme, and Pixabay. It recognizes each host from the page URL, reads `src`, `srcset`, `<picture>` sources, direct image links, and Open Graph or Twitter card images. That makes it useful on most image-heavy pages, not only the engines in the strip.

The absorber reads only images already displayed on that page. It does not read cookies, private data, or results behind a login. Links land in the displayed-link buffer and can be saved to any board. Some engines may block pop-ups or isolate the opened tab; allow pop-ups for the engine and retry. The absorber retries its hand-off for about 15 seconds.

## Privacy

- No accounts, analytics, cookies, tracking pixels, or third-party scripts.
- Search queries are sent directly from the browser to the sources you choose. There is no Sift server in the middle.
- Every source sees an IP address. Image hosts and APIs can see the address that requests a page or a picture, even with `no-referrer` set. A VPN puts the VPN's address in those logs instead of your home address.
- Before the first search, Sift asks whether to classify the connection as VPN, Tor, proxy, datacenter, or residential. The check uses [ipquery.io](https://ipquery.io), which also sees your IP. It does not run automatically on page load: open the **Check VPN** pill or the settings panel and choose **Check connection**. The result is stored locally and expires after 30 minutes.
- If the connection is unprotected, Sift explains the trade-off and lets you continue, acknowledge for 12 hours, or stop. A protected connection unlocks the same sources without the warning.
- Search history stays in memory only and is discarded on reload.
- Pinterest import is optional and stays in the browser. The bookmarklet reads Pinterest using your current Pinterest session and hands normalized data to Sift; Sift never receives your Pinterest credentials.
- Web image capture is optional and runs only when you click the absorber on an image-search tab. It writes displayed links to this browser's buffer; nothing passes through a Sift server.
- Export your boards as JSON at any time. Erasing site data removes the IndexedDB archive, localStorage mirror, buffer, and saved connection result permanently.

## Image sources

Direct, no-key APIs:

- [Openverse](https://openverse.org) — broad openly licensed image search.
- [Wikimedia Commons](https://commons.wikimedia.org) — open media, plus random discoveries for the Wild mix.
- [Art Institute of Chicago](https://www.artic.edu) — collection search and IIIF images.
- [The Met](https://www.metmuseum.org) — collection search and object records.
- [V&A](https://www.vam.ac.uk) — museum collection search.
- [Are.na](https://www.are.na) — channels and blocks from a design/art community.
- [NASA Image Library](https://images.nasa.gov) — spaceflight, earth, and astronomy imagery.
- [Library of Congress](https://www.loc.gov) — photographs, prints, and historical collections.
- [Internet Archive](https://archive.org) — book images, ephemera, and archival scans.
- [Meme Stream](https://meme-api.com) — public meme subreddits for the Current and Memes groups.

Search groups are **Everything**, **Open collections**, **Art museums**, **Current & wild**, **Memes**, and **Archives**. Each group maps to a different subset of the APIs above, so you can widen or narrow the search without changing the query. **Everything** is the broad open/museum/current mix; random memes and text-heavy archive scans stay in their own groups so a keyword search is not diluted by them.

Web image tabs for DuckDuckGo, Bing Images, Google Images, Reddit, Giphy, ArtStation, Are.na, Pinterest, Unsplash, Pexels, and many more are read through the displayed-image-tab absorber. Related images use the saved pin's tags, then Openverse's related-image endpoint when an Openverse image ID is available. Pinterest imports only image URLs and metadata from pins; Sift does not grant rights to those images.

Openverse anonymous API limits apply (currently 20 requests per minute and 200 per day, with a separate thumbnail limit). Museum, archive, and meme APIs have their own limits and may rate-limit or go down; Sift cools a failing source down and keeps mixing the rest. Check the license and rights statement on each original source page before reusing an image.

## Files

- `index.html` — app shell, dialogs, icons, CSP, and metadata.
- `styles.css` — layout, themes, cards, masonry, dialogs, and responsive styles.
- `app.js` — state, API calls, rotating feed, lazy board rendering, IndexedDB persistence, Pinterest chunking, and interactions.
- `assets/fonts/` — self-hosted Fraunces and Instrument Sans subset files.
- `favicon.svg` — site mark.
- `.nojekyll` — bypasses Jekyll when this folder is the Pages root.
