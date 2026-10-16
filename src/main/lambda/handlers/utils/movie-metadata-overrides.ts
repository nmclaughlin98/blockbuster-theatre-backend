export interface MovieMetadataOverride {
    title?: string;
    slug?: string;
    sortTitle?: string;
}

export const TMDB_MOVIE_METADATA_OVERRIDES: Readonly<
    Record<number, MovieMetadataOverride>
> = {
    // Add metadata overrides for other franchises or collections here.
    1893: {
        title: 'Star Wars: Episode I - The Phantom Menace',
        slug: 'star-wars-the-phantom-menace',
        sortTitle: 'Star Wars 01 - The Phantom Menace',
    },
    1894: {
        title: 'Star Wars: Episode II - Attack of the Clones',
        slug: 'star-wars-attack-of-the-clones',
        sortTitle: 'Star Wars 02 - Attack of the Clones',
    },
    1895: {
        title: 'Star Wars: Episode III - Revenge of the Sith',
        slug: 'star-wars-revenge-of-the-sith',
        sortTitle: 'Star Wars 03 - Revenge of the Sith',
    },
    11: {
        title: 'Star Wars: Episode IV - A New Hope',
        slug: 'star-wars-a-new-hope',
        sortTitle: 'Star Wars 04 - A New Hope',
    },
    1891: {
        title: 'Star Wars: Episode V - The Empire Strikes Back',
        slug: 'star-wars-the-empire-strikes-back',
        sortTitle: 'Star Wars 05 - The Empire Strikes Back',
    },
    1892: {
        title: 'Star Wars: Episode VI - Return of the Jedi',
        slug: 'star-wars-return-of-the-jedi',
        sortTitle: 'Star Wars 06 - Return of the Jedi',
    },
    140607: {
        title: 'Star Wars: Episode VII - The Force Awakens',
        slug: 'star-wars-the-force-awakens',
        sortTitle: 'Star Wars 07 - The Force Awakens',
    },
    181808: {
        title: 'Star Wars: Episode VIII - The Last Jedi',
        slug: 'star-wars-the-last-jedi',
        sortTitle: 'Star Wars 08 - The Last Jedi',
    },
    181812: {
        title: 'Star Wars: Episode IX - The Rise of Skywalker',
        slug: 'star-wars-the-rise-of-skywalker',
        sortTitle: 'Star Wars 09 - The Rise of Skywalker',
    },
    330459: {
        sortTitle: 'Star Wars 03.5 - Rogue One',
    },
    348350: {
        sortTitle: 'Star Wars 03.4 - Solo',
    },
};
