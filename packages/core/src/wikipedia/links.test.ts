import { describe, expect, it } from "vitest";
import { canonicalizeUrl, extractUrls } from "../url";
import {
  canonicalWikipediaUrl,
  isWikipediaArticleUrl,
  parseWikipediaUrl,
  wikipediaApiUrls,
  wikipediaArticleUrl,
} from "./links";

describe("parseWikipediaUrl", () => {
  it("reads a plain article link", () => {
    expect(parseWikipediaUrl("https://en.wikipedia.org/wiki/Turbocharger")).toEqual({
      language: "en",
      title: "Turbocharger",
      url: "https://en.wikipedia.org/wiki/Turbocharger",
    });
  });

  it("accepts any language edition", () => {
    expect(parseWikipediaUrl("https://de.wikipedia.org/wiki/Turbolader")?.language).toBe("de");
    expect(parseWikipediaUrl("https://zh-yue.wikipedia.org/wiki/Foo")?.language).toBe("zh-yue");
    expect(parseWikipediaUrl("https://simple.wikipedia.org/wiki/Car")?.language).toBe("simple");
  });

  it("treats the mobile host as the desktop one", () => {
    expect(canonicalWikipediaUrl("https://en.m.wikipedia.org/wiki/Turbocharger")).toBe(
      "https://en.wikipedia.org/wiki/Turbocharger",
    );
    expect(canonicalWikipediaUrl("http://fr.m.wikipedia.org/wiki/Moteur")).toBe(
      "https://fr.wikipedia.org/wiki/Moteur",
    );
  });

  it("drops #sections and other query parameters", () => {
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/wiki/Turbocharger#History")).toBe(
      "https://en.wikipedia.org/wiki/Turbocharger",
    );
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/wiki/Turbocharger?oldformat=true")).toBe(
      "https://en.wikipedia.org/wiki/Turbocharger",
    );
  });

  it("reads index.php?title= forms", () => {
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/w/index.php?title=Turbocharger")).toBe(
      "https://en.wikipedia.org/wiki/Turbocharger",
    );
    expect(
      canonicalWikipediaUrl(
        "https://en.wikipedia.org/w/index.php?title=Rubik%27s_Cube&action=edit",
      ),
    ).toBe("https://en.wikipedia.org/wiki/Rubik's_Cube");
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/w/index.php?curid=1234")).toBeNull();
  });

  it("uses underscores and keeps readable punctuation", () => {
    expect(
      canonicalWikipediaUrl("https://en.wikipedia.org/wiki/Star Wars: The Force Awakens"),
    ).toBe("https://en.wikipedia.org/wiki/Star_Wars:_The_Force_Awakens");
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/wiki/Brown,_Boveri_%26_Cie")).toBe(
      "https://en.wikipedia.org/wiki/Brown,_Boveri_%26_Cie",
    );
  });

  it("encodes parentheses so Markdown links stay intact", () => {
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/wiki/Turbo_(disambiguation)")).toBe(
      "https://en.wikipedia.org/wiki/Turbo_%28disambiguation%29",
    );
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/wiki/Turbo_%28disambiguation%29")).toBe(
      "https://en.wikipedia.org/wiki/Turbo_%28disambiguation%29",
    );
  });

  it("encodes non-ASCII titles the same whether pasted raw or encoded", () => {
    const encoded = "https://en.wikipedia.org/wiki/Caf%C3%A9";
    expect(canonicalWikipediaUrl("https://en.wikipedia.org/wiki/Café")).toBe(encoded);
    expect(canonicalWikipediaUrl(encoded)).toBe(encoded);
    expect(parseWikipediaUrl(encoded)?.title).toBe("Café");
  });

  it("keeps a slash in a title encoded", () => {
    const ref = parseWikipediaUrl("https://en.wikipedia.org/wiki/AC/DC");
    expect(ref?.title).toBe("AC/DC");
    expect(ref?.url).toBe("https://en.wikipedia.org/wiki/AC%2FDC");
  });

  it("rejects other namespaces", () => {
    for (const title of [
      "Special:Search",
      "Talk:Turbocharger",
      "File:Turbo.jpg",
      "Image:Turbo.jpg",
      "Category:Engines",
      "Help:Contents",
      "Wikipedia:About",
      "WP:NPOV",
      "User:Jimbo",
      "User_talk:Jimbo",
      "Template:Infobox",
      "Portal:Cars",
      "Draft:Foo",
      "Module:Foo",
      "MediaWiki:Common.css",
      "category:lowercase",
    ]) {
      expect(parseWikipediaUrl(`https://en.wikipedia.org/wiki/${title}`)).toBeNull();
    }
    expect(
      parseWikipediaUrl("https://en.wikipedia.org/w/index.php?title=Special:Search&search=x"),
    ).toBeNull();
  });

  it("keeps articles that merely have a colon in the title", () => {
    expect(isWikipediaArticleUrl("https://en.wikipedia.org/wiki/Star_Wars:_The_Last_Jedi")).toBe(
      true,
    );
    expect(isWikipediaArticleUrl("https://en.wikipedia.org/wiki/Re:Zero")).toBe(true);
  });

  it("rejects pages that aren't article links", () => {
    expect(parseWikipediaUrl("https://en.wikipedia.org/")).toBeNull();
    expect(parseWikipediaUrl("https://en.wikipedia.org/wiki/")).toBeNull();
    expect(parseWikipediaUrl("https://www.wikipedia.org/wiki/Cars")).toBeNull();
    expect(parseWikipediaUrl("https://wikipedia.org/wiki/AI")).toBeNull();
    expect(parseWikipediaUrl("https://commons.wikipedia.org/wiki/Cars")).toBeNull();
    expect(parseWikipediaUrl("https://en.wikipedia.org.evil.com/wiki/Cars")).toBeNull();
    expect(parseWikipediaUrl("https://en.wiktionary.org/wiki/car")).toBeNull();
    expect(parseWikipediaUrl("https://grokipedia.com/page/Car")).toBeNull();
    expect(parseWikipediaUrl("ftp://en.wikipedia.org/wiki/Car")).toBeNull();
    expect(parseWikipediaUrl("not a url")).toBeNull();
  });
});

describe("wikipediaApiUrls", () => {
  it("builds the REST addresses with the title encoded", () => {
    const ref = parseWikipediaUrl("https://de.wikipedia.org/wiki/AC/DC");
    expect(ref).not.toBeNull();
    const urls = wikipediaApiUrls(ref!);
    expect(urls.html).toBe("https://de.wikipedia.org/api/rest_v1/page/html/AC%2FDC");
    expect(urls.summary).toBe("https://de.wikipedia.org/api/rest_v1/page/summary/AC%2FDC");
  });
});

describe("wikipediaArticleUrl", () => {
  it("normalizes spaces to underscores", () => {
    expect(wikipediaArticleUrl("en", "Rudolf Diesel")).toBe(
      "https://en.wikipedia.org/wiki/Rudolf_Diesel",
    );
  });
});

describe("canonicalizeUrl and extractUrls with Wikipedia links", () => {
  it("leaves canonical Wikipedia addresses unchanged", () => {
    const urls = [
      "https://en.wikipedia.org/wiki/Turbocharger",
      "https://en.wikipedia.org/wiki/Turbo_%28disambiguation%29",
      "https://en.wikipedia.org/wiki/Caf%C3%A9",
      "https://en.wikipedia.org/wiki/AC%2FDC",
    ];
    for (const url of urls) expect(canonicalizeUrl(url)).toBe(url);
  });

  it("folds the different forms of a link into one", () => {
    expect(canonicalizeUrl("https://en.m.wikipedia.org/wiki/Turbocharger#History")).toBe(
      "https://en.wikipedia.org/wiki/Turbocharger",
    );
  });

  it("doesn't merge different ?title= articles when pasting several links", () => {
    const text = [
      "https://en.wikipedia.org/w/index.php?title=Turbocharger",
      "https://en.wikipedia.org/w/index.php?title=Supercharger",
      "https://en.wikipedia.org/wiki/Turbocharger",
    ].join("\n");
    expect(extractUrls(text)).toEqual([
      "https://en.wikipedia.org/w/index.php?title=Turbocharger",
      "https://en.wikipedia.org/w/index.php?title=Supercharger",
    ]);
  });
});
