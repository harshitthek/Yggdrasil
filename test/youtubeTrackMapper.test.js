import assert from 'node:assert/strict';
import { test } from 'node:test';

import { YoutubeTrackMapper } from '../src/services/music/youtube/YoutubeTrackMapper.js';

function createMapper() {
  return new YoutubeTrackMapper({
    context: { player: { nodes: { cache: new Map() } } },
    identifier: 'WorldTreeYoutube'
  });
}

test('YoutubeTrackMapper maps a YouTube video into a Track', () => {
  const requestedBy = { id: 'user-1' };
  const track = createMapper().buildTrack(
    {
      video_id: 'abc123',
      title: { toString: () => 'Example video' },
      author: { name: 'Example channel', url: 'https://www.youtube.com/@example' },
      thumbnails: [{ url: 'https://img.example/video.jpg' }],
      duration: { seconds: 125 },
      view_count: { toString: () => '1.2M views' },
      published: { toString: () => '2 years ago' },
      is_live: false
    },
    { requestedBy }
  );

  assert.ok(track);
  assert.equal(track.title, 'Example video');
  assert.equal(track.author, 'Example channel');
  assert.equal(track.url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(track.thumbnail, 'https://img.example/video.jpg');
  assert.equal(track.duration, '02:05');
  assert.equal(track.durationMS, 125_000);
  assert.equal(track.views, 1_200_000);
  assert.equal(track.requestedBy, requestedBy);
  assert.equal(track.source, 'youtube');
  assert.deepEqual(track.raw.youtube, {
    videoId: 'abc123',
    uploadDate: '2 years ago',
    channel: { name: 'Example channel', url: 'https://www.youtube.com/@example' },
    extractorIdentifier: 'WorldTreeYoutube'
  });
});

test('YoutubeTrackMapper maps a playlist and assigns the playlist to each Track', () => {
  const playlist = createMapper().buildPlaylist(
    {
      info: {
        title: 'Example playlist',
        description: 'Playlist description',
        author: { name: 'Playlist owner', url: 'https://www.youtube.com/@owner' },
        thumbnails: [{ url: 'https://img.example/playlist.jpg' }]
      },
      items: [
        {
          id: 'first-video',
          title: { text: 'First video', toString: () => 'First video' },
          author: { name: 'Channel one' },
          thumbnails: [{ url: 'https://img.example/first.jpg' }],
          duration: { seconds: 60 }
        }
      ]
    },
    { playlistId: 'playlist-1' }
  );

  assert.ok(playlist);
  assert.equal(playlist.title, 'Example playlist');
  assert.equal(playlist.url, 'https://www.youtube.com/playlist?list=playlist-1');
  assert.equal(playlist.author.name, 'Playlist owner');
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].playlist, playlist);
  assert.equal(playlist.tracks[0].url, 'https://www.youtube.com/watch?v=first-video');
});

test('YoutubeTrackMapper uses safe defaults for optional metadata', () => {
  const track = createMapper().buildTrack({ video_id: 'minimal-video' });

  assert.ok(track);
  assert.equal(track.title, 'UNKNOWN TITLE');
  assert.equal(track.author, 'UNKNOWN AUTHOR');
  assert.equal(track.thumbnail, '');
  assert.equal(track.duration, '0:00');
  assert.equal(track.durationMS, 0);
  assert.equal(track.views, 0);
  assert.equal(track.raw.youtube.uploadDate, '');
});

test('YoutubeTrackMapper rejects malformed metadata without throwing', () => {
  const mapper = createMapper();

  assert.equal(mapper.buildTrack(null), null);
  assert.equal(mapper.buildTrack({ title: 'No video ID' }), null);
  assert.equal(mapper.buildPlaylist({ info: { title: 'No playlist ID' } }), null);
});

test('YoutubeTrackMapper returns an empty search result for empty or malformed input', () => {
  const mapper = createMapper();

  assert.deepEqual(mapper.buildSearchResult({ results: [] }), { playlist: null, tracks: [] });
  assert.deepEqual(mapper.buildSearchResult({}), { playlist: null, tracks: [] });
});
