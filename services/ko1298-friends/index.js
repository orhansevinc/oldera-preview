'use strict';

const { FriendRepository, UserDirectory, PresencePort } = require('./contracts');
const { MemoryFriendRepository } = require('./memory-repository');
const { PresenceRegistry } = require('./presence');
const { FriendsService, MAX_REPORTED_FRIENDS_1298 } = require('./friends-service');

module.exports = {
  FriendRepository,
  UserDirectory,
  PresencePort,
  MemoryFriendRepository,
  PresenceRegistry,
  FriendsService,
  MAX_REPORTED_FRIENDS_1298,
};
