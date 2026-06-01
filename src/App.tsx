import React from 'react';
import CardEngine from './components/cardengine/CardEngine';
import { loadCardDB } from './lib/cardEngine/loadCardDB';
import cardDB from './data/cardDB.json';

const db = loadCardDB(cardDB as any);

export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#000' }}>
      <CardEngine db={db} />
    </div>
  );
}
