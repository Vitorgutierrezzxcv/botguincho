import assert from 'node:assert/strict';
import { evaluateOperatingHours } from './operating-hours.mjs';
import { capacitySnapshot } from './dispatch-capacity.mjs';
import { scheduledCapacitySnapshot, isFutureScheduledCall } from './scheduling-policy.mjs';
import { selectRecentUnprocessedMessages } from './whatsapp-recovery.mjs';

const closedSettings = {
  operatingHoursEnabled: true,
  operatingTimezone: 'America/Sao_Paulo',
  weeklySchedule: {
    mon:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    tue:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    wed:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    thu:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    fri:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    sat:{enabled:false,intervals:[]}, sun:{enabled:false,intervals:[]},
  },
};
assert.equal(evaluateOperatingHours(closedSettings, new Date('2026-09-01T04:48:00Z')).open, false, '01:48 em SP precisa estar fechado');
assert.equal(evaluateOperatingHours(closedSettings, new Date('2026-09-01T14:00:00Z')).open, true, '11:00 em SP precisa estar aberto');

let state={calls:[{id:'1',status:'autorizado',createdAt:'2026-09-01T12:00:00Z'}]};
assert.equal(capacitySnapshot(state).canAccept,true);
state.calls.push({id:'2',status:'a_caminho',createdAt:'2026-09-01T12:10:00Z'});
assert.equal(capacitySnapshot(state).activeCount,2);
assert.equal(capacitySnapshot(state).canAccept,false,'terceira corrida precisa ser bloqueada');

const slot='2026-09-02T10:00:00-03:00';
const sched=[{id:'a',status:'agendado',scheduledAt:slot},{id:'b',status:'agendado',scheduledAt:'2026-09-02T10:30:00-03:00'}];
assert.equal(scheduledCapacitySnapshot(sched, '2026-09-02T10:15:00-03:00').canAccept,false,'terceiro agendamento simultâneo precisa ser bloqueado');
assert.equal(isFutureScheduledCall(slot,new Date('2026-09-01T12:00:00Z'),60),true);

const now=Date.now();
const messages=[
  {id:{_serialized:'old-ok'},timestamp:Math.floor((now-40*60000)/1000),body:'pode seguir',fromMe:false},
  {id:{_serialized:'blank'},timestamp:Math.floor((now-10*60000)/1000),body:'',fromMe:false},
  {id:{_serialized:'mine'},timestamp:Math.floor((now-5*60000)/1000),body:'teste',fromMe:true},
];
const recovered=selectRecentUnprocessedMessages(messages,{sinceMs:now-60*60000,nowMs:now,maxWindowMs:60*60000,startupSkewMs:60000});
assert.deepEqual(recovered.map(x=>x.id._serialized),['old-ok']);
console.log('RUNTIME_REGRESSIONS_OK');
