/**
 * Centralized NFT Collections Configuration
 * Add new collections here to extend the service without code changes
 */

export const COLLECTIONS = {
  therealmkin: {
    name: 'therealmkin',
    displayName: 'The Realmkin',
    // Magic Eden collection address
    address: '89KnhXiCHb2eGP2jRGzEQX3B8NTyqHEVmu55syDWSnL8',
    // Magic Eden collection symbol/identifier
    symbols: ['therealmkin'],
    // Primary API source for this collection
    primarySource: 'magic_eden',
    // Fallback sources
    fallbackSources: ['helius'],
    // Whether this collection supports class-based filtering
    supportsClassFilter: true,
    // Valid class values for this collection
    validClasses: ['King', 'Queen', 'Wizard', 'Warrior', 'Rogue', 'Cleric', 'Mage', 'Priest', 'Chef', 'Butler', 'Noble', 'Jester', 'Chief', 'Witch', 'Knight', 'Soldier'],
    // Attribute name to use for class filtering
    classAttributeName: 'Class',
  },
  realmkin_helius: {
    name: 'realmkin_helius',
    displayName: 'Realmkin (Helius)',
    // Helius collection address
    address: 'eTQujiFKVvLJXdkAobg9JqULNdDrCt5t4WtDochmVSZ',
    symbols: [],
    primarySource: 'helius',
    fallbackSources: [],
    supportsClassFilter: false,
    validClasses: ['King', 'Queen', 'Wizard', 'Warrior', 'Rogue', 'Cleric', 'Mage', 'Priest', 'Chef', 'Butler', 'Noble', 'Jester', 'Chief', 'Witch', 'Knight', 'Soldier'],
    classAttributeName: 'Class',
  },
  realmkin_mass_mint: {
    name: 'realmkin_mass_mint',
    displayName: 'Realmkin Mass Mint',
    address: 'EzjhzaTBqXohJTsaMKFSX6fgXcDJyXAV85NK7RK79u3Z',
    symbols: [],
    primarySource: 'helius',
    fallbackSources: [],
    supportsClassFilter: false,
    validClasses: ['King', 'Queen', 'Wizard', 'Warrior', 'Rogue', 'Cleric', 'Mage', 'Priest', 'Chef', 'Butler', 'Noble', 'Jester', 'Chief', 'Witch', 'Knight', 'Soldier'],
    classAttributeName: 'Class',
  },
};

/**
 * Get collection config by name
 * @param {string} collectionName - Name of the collection
 * @returns {Object|null} Collection configuration or null if not found
 */
export const getCollectionConfig = (collectionName) => {
  return COLLECTIONS[collectionName] || null;
};

/**
 * Get all collection names
 * @returns {string[]} Array of collection names
 */
export const getCollectionNames = () => {
  return Object.keys(COLLECTIONS);
};

/**
 * Get all collections that support class filtering
 * @returns {Object} Collections that support class filtering
 */
export const getClassFilterableCollections = () => {
  return Object.fromEntries(
    Object.entries(COLLECTIONS).filter(([_, config]) => config.supportsClassFilter)
  );
};
