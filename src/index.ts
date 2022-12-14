import Adb, { DeviceClient } from '@u4/adbkit';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Device from '@u4/adbkit/dist/models/Device';
import { updateCustomConfigPath, updateCustomGamePath } from './settings';
import { SyncOption } from './types';
import {
  getLocalPlayer,
  getPcPlayerData,
  getQuestPlayerData,
  updatePcPlayerData,
  updateQuestPlayerData,
} from './utils/playerData';
import {
  addPlaylistToPc,
  addPlaylistToQuest,
  getPcPlaylists,
  getQuestPlaylists,
  removePlaylistFromPc,
  removePlaylistFromQuest,
} from './utils/playlist';
import {
  getBeatSaberConfigPath,
  getBeatSaberGamePath,
  isValidBeatSaberConfigPath,
  isValidBeatSaberGamePath,
} from './utils/pcPaths';

// initialize pc
let beatSaberConfigPath = getBeatSaberConfigPath();
// validate path exists
if (!isValidBeatSaberConfigPath(beatSaberConfigPath)) {
  console.log(chalk.red(`Beat Saber config path ${beatSaberConfigPath} does not exist`));
  // ask for a new path
  const { customPath } = await inquirer.prompt<{
    customPath: string;
  }>([
    {
      type: 'input',
      name: 'customPath',
      message: 'Please enter the path to your Beat Saber config folder',
      validate: input => isValidBeatSaberConfigPath(input),
    },
  ]);
  beatSaberConfigPath = customPath;
  updateCustomConfigPath(customPath);
}
let beatSaberGamePath = getBeatSaberGamePath();
// validate path exists
if (!isValidBeatSaberGamePath(beatSaberGamePath)) {
  console.log(chalk.red(`Beat Saber game path ${beatSaberGamePath} does not exist`));
  // ask for a new path
  const { customPath } = await inquirer.prompt<{
    customPath: string;
  }>([
    {
      type: 'input',
      name: 'customPath',
      message: 'Please enter the path to your Beat Saber game folder',
      validate: input => isValidBeatSaberGamePath(input),
    },
  ]);
  beatSaberGamePath = customPath;
  updateCustomGamePath(customPath);
}

// initialize adb
// TODO: check if adb is installed
const client = Adb.createClient();
const devices = await client.listDevices();

if (!devices.length) {
  console.log(
    chalk.red('No devices found, make sure you have a Quest connected and USB debugging enabled')
  );
  process.exit(1);
}

if (devices.length === 1) {
  await syncQuestAndPc(devices[0]);
} else {
  await chooseDevice();
}

/**
 * Choose an ADB device in case there are multiple
 */
async function chooseDevice() {
  const { device } = await inquirer.prompt<{
    device: Device;
  }>([
    {
      type: 'list',
      name: 'device',
      message: 'Found multiple devices, please choose one',
      choices: devices.map(device => ({
        name: device.id,
        value: device,
      })),
    },
  ]);
  await syncQuestAndPc(device);
}

/**
 * Bidirectional sync between Quest and PC
 */
async function syncQuestAndPc(device: Device) {
  console.log(chalk.green(`Syncing from ${device.id} to PC...`));

  if (device.type !== 'device') {
    console.log(chalk.red('Device is not authorized, please authorize it in the headset'));
    process.exit(1);
  }

  const client = device.getClient();
  await syncFavorites(client);
  await syncPlaylists(client);
}

/**
 * Bidirectional sync for favorites
 */
async function syncFavorites(client: DeviceClient) {
  const sync = await client.syncService();

  // get player data from quest and pc
  // TODO: catch JSON parse errors
  const questPlayerData = await getQuestPlayerData(sync);
  const questLocalPlayer = getLocalPlayer(questPlayerData);

  const pcPlayerData = getPcPlayerData(beatSaberConfigPath);
  const pcLocalPlayer = getLocalPlayer(pcPlayerData);

  // TODO: make a backup of the player data before syncing and add an option to restore it

  // sync favorites
  const questFavorites = questLocalPlayer.favoritesLevelIds;
  const pcFavorites = pcLocalPlayer.favoritesLevelIds;

  // find favorites on quest that are not on pc
  const onlyOnQuestFavorites = questFavorites.filter(id => !pcFavorites.includes(id));
  // find favorites on pc that are not on quest
  const onlyOnPcFavorites = pcFavorites.filter(id => !questFavorites.includes(id));

  // TODO: make a selection for each individual item

  if (onlyOnQuestFavorites.length) {
    console.log(
      chalk.green(`Found ${onlyOnQuestFavorites.length} favorites that are on Quest but not on PC`)
    );
    // ask if they want to remove them from quest or add them to pc
    const { action } = await inquirer.prompt<{
      action: SyncOption;
    }>([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do with these favorites?',
        choices: [
          {
            name: 'Add to PC',
            value: 'pc',
          },
          {
            name: 'Remove from Quest',
            value: 'quest',
          },
          // TODO: add option to do nothing
        ],
      },
    ]);
    if (action === 'pc') {
      // add favorites to pc
      pcLocalPlayer.favoritesLevelIds = [...pcFavorites, ...onlyOnQuestFavorites];
      updatePcPlayerData(beatSaberConfigPath, pcPlayerData);
    } else {
      // remove favorites from quest
      questLocalPlayer.favoritesLevelIds = onlyOnQuestFavorites;
      await updateQuestPlayerData(sync, questPlayerData);
    }
  }

  if (onlyOnPcFavorites.length) {
    console.log(
      chalk.green(`Found ${onlyOnPcFavorites.length} favorites that are on PC but not on Quest`)
    );
    // ask if they want to add them to quest or remove them from pc
    const { action } = await inquirer.prompt<{
      action: SyncOption;
    }>([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do with these favorites?',
        choices: [
          {
            name: 'Add to Quest',
            value: 'quest',
          },
          {
            name: 'Remove from PC',
            value: 'pc',
          },
          // TODO: add option to do nothing
        ],
      },
    ]);
    if (action === 'quest') {
      // add favorites to quest
      questLocalPlayer.favoritesLevelIds = [...questFavorites, ...onlyOnPcFavorites];
      await updateQuestPlayerData(sync, questPlayerData);
    } else {
      // remove favorites from pc
      pcLocalPlayer.favoritesLevelIds = onlyOnPcFavorites;
      updatePcPlayerData(beatSaberConfigPath, pcPlayerData);
    }
  }

  sync.end();
  // TODO: sync more player data?
}

/**
 * Bidirectional sync for playlists
 */
async function syncPlaylists(client: DeviceClient) {
  const sync = await client.syncService();

  // sync playlists
  const questPlaylists = await getQuestPlaylists(client);
  const pcPlaylists = getPcPlaylists(beatSaberGamePath);

  // find playlists on quest that are not on pc
  const onlyOnQuestPlaylists = questPlaylists.filter(
    playlist =>
      !pcPlaylists.find(
        pcPlaylist => pcPlaylist.playlist.playlistTitle === playlist.playlist.playlistTitle
      )
  );
  // find playlists on pc that are not on quest
  const onlyOnPcPlaylists = pcPlaylists.filter(
    playlist =>
      !questPlaylists.find(
        questPlaylist => questPlaylist.playlist.playlistTitle === playlist.playlist.playlistTitle
      )
  );

  if (onlyOnQuestPlaylists.length) {
    console.log(
      chalk.green(`Found ${onlyOnQuestPlaylists.length} playlists that are on Quest but not on PC`),
      onlyOnQuestPlaylists.map(x => x.playlist.playlistTitle)
    );
    // ask if they want to remove them from quest or add them to pc
    const { action } = await inquirer.prompt<{
      action: SyncOption;
    }>([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do with these playlists?',
        choices: [
          {
            name: 'Add to PC',
            value: 'pc',
          },
          {
            name: 'Remove from Quest',
            value: 'quest',
          },
          // TODO: add option to do nothing
        ],
      },
    ]);
    if (action === 'pc') {
      // add playlists to pc
      for (const playlist of onlyOnQuestPlaylists) {
        addPlaylistToPc(playlist, beatSaberGamePath);
      }
    } else {
      // remove playlists from quest
      for (const playlist of onlyOnQuestPlaylists) {
        await removePlaylistFromQuest(playlist, client);
      }
    }
  }

  if (onlyOnPcPlaylists.length) {
    console.log(
      chalk.green(
        `Found ${onlyOnPcPlaylists.length} playlists that are on PC but not on Quest`,
        onlyOnPcPlaylists.map(x => x.playlist.playlistTitle)
      )
    );
    // ask if they want to add them to quest or remove them from pc
    const { action } = await inquirer.prompt<{
      action: SyncOption;
    }>([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do with these playlists?',
        choices: [
          {
            name: 'Add to Quest',
            value: 'quest',
          },
          {
            name: 'Remove from PC',
            value: 'pc',
          },
        ],
      },
    ]);
    if (action === 'quest') {
      // add playlists to quest
      for (const playlist of onlyOnPcPlaylists) {
        await addPlaylistToQuest(playlist, client);
      }
    } else {
      // remove playlists from pc
      for (const playlist of onlyOnPcPlaylists) {
        removePlaylistFromPc(playlist, beatSaberGamePath);
      }
    }
  }

  sync.end();
}
