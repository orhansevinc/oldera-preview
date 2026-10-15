BEGIN;

INSERT INTO oldko.accounts(id,username,username_key,password_hash,email,status,nation,inn_version,verified_at,password_version,created_at,updated_at,last_login_at)
VALUES (1001,'RecoveryUser','recoveryuser','scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==','recovery@example.invalid','active',1,3,now()-interval '30 days',2,now()-interval '30 days',now()-interval '1 minute',now()-interval '1 minute');

INSERT INTO oldko.account_sessions(account_id,token_hash,source_ip,user_agent,created_at,expires_at,last_seen_at,password_version)
VALUES (1001,decode(repeat('11',32),'hex'),'127.0.0.1','ws30-recovery',now()-interval '10 minutes',now()+interval '1 hour',now()-interval '1 minute',2);

INSERT INTO oldko.account_action_tokens(id,kind,account_id,token_hash,created_at,expires_at)
VALUES ('11111111-1111-4111-8111-111111111111','account_verification',1001,decode(repeat('22',32),'hex'),now()-interval '1 minute',now()+interval '1 day');

INSERT INTO oldko.account_rate_limits(bucket_hash,count,reset_at,updated_at)
VALUES (repeat('a',64),3,now()+interval '5 minutes',now());

INSERT INTO oldko.characters(id,account_id,slot,name,name_key,nation,race,class_id,face,hair,zone_id,pos_x,pos_y,pos_z,item_version,world_version,world_state,last_world_saved_at)
VALUES (2001,1001,0,'RecoveryHero','recoveryhero',1,1,101,0,0,21,815.0,0.0,510.0,4,5,'{"zone":21,"checkpoint":"moradon"}'::jsonb,now()-interval '30 seconds');

INSERT INTO oldko.character_stats(character_id,level,experience,hp,mp,str,sta,dex,intel,cha,stat_points,skill_points,loyalty,gold,progression_version)
VALUES (2001,3,1200,180,120,65,60,55,50,50,2,1,75,12345,7);

INSERT INTO oldko.character_skills(character_id,skills,version)
VALUES (2001,'{"101003":1}'::jsonb,3);

INSERT INTO oldko.server_state(key,value,version,updated_by)
VALUES ('world:recovery','{"zone":21,"saved":true}'::jsonb,2,1001);

INSERT INTO oldko.item_instances(id,serial,item_template_id,stack_count,durability,version,custom_data)
VALUES
  (3001,930000000001,120010000,1,100,4,'{"kind":"equipment"}'::jsonb),
  (3002,930000000002,900001000,5,80,2,'{"kind":"inventory"}'::jsonb),
  (3003,930000000003,900002000,2,70,2,'{"kind":"inn"}'::jsonb);

INSERT INTO oldko.character_items(id,character_id,slot,item_instance_id) VALUES (4001,2001,0,3001);
INSERT INTO oldko.inventory(id,character_id,slot,item_instance_id) VALUES (4002,2001,0,3002);
INSERT INTO oldko.inn_storage(id,account_id,page,slot,item_instance_id) VALUES (4003,1001,0,0,3003);

INSERT INTO oldko.admin_actors(id,username,username_key,password_hash,roles,enabled)
VALUES ('recovery-admin','RecoveryAdmin','recoveryadmin','not-used-in-recovery',ARRAY['root','operator'],true);

INSERT INTO oldko.admin_sessions(id,actor_id,token_hash,source_ip,user_agent,created_at,expires_at,last_seen_at)
VALUES ('22222222-2222-4222-8222-222222222222','recovery-admin',decode(repeat('33',32),'hex'),'127.0.0.1','ws30-admin-recovery',now()-interval '5 minutes',now()+interval '2 hours',now());

INSERT INTO oldko.admin_operation_receipts(actor_id,idempotency_key_hash,request_hash,state,response)
VALUES ('recovery-admin',decode(repeat('44',32),'hex'),decode(repeat('55',32),'hex'),'completed','{"ok":true,"source":"ws30"}'::jsonb);

INSERT INTO oldko.admin_command_outbox(id,command,target,arg,requested_by,requested_by_admin_id,trace_id,source,status,expected_character_id,expected_world_version,expected_progression_version,expected_item_version,attempt_count,claimed_at,claimed_by,completed_at)
VALUES ('33333333-3333-4333-8333-333333333333','kick','RecoveryHero','','RecoveryAdmin','recovery-admin','ws30-recovery-command-1','ws30-recovery','succeeded',2001,5,7,4,1,now()-interval '20 seconds','ws30-ci',now()-interval '10 seconds');

INSERT INTO oldko.persistence_operations(operation_id,kind,actor_account_id,character_id,metadata,committed_at)
VALUES ('ws30-recovery-operation-1','recovery-rehearsal',1001,2001,'{"idempotency":"preserved"}'::jsonb,now());

INSERT INTO oldko.bans(id,account_id,reason,expires_at,request_id,created_by_admin_id)
VALUES (7001,1001,'ws30 recovery evidence',now()+interval '1 day','ws30-recovery-sanction-1','recovery-admin');

INSERT INTO oldko.admin_item_flags(item_instance_id,state,note,actor_admin_id,actor_label,trace_id)
VALUES (3001,'flagged','ws30 recovery evidence','recovery-admin','RecoveryAdmin','ws30-recovery-item-flag-1');

INSERT INTO oldko.audit_log(id,actor_admin_id,action,target_type,target_id,request_id,source_ip,details)
VALUES (5001,'recovery-admin','recovery.seed','character','RecoveryHero','ws30-recovery-audit-1','127.0.0.1','{"source":"ws30"}'::jsonb);

INSERT INTO oldko.item_serial_events(id,item_instance_id,serial,action,actor_admin_id,actor_label,trace_id,details)
VALUES (6001,3001,930000000001,'SEED_EVIDENCE','recovery-admin','RecoveryAdmin','ws30-recovery-serial-1','{"source":"ws30"}'::jsonb);

INSERT INTO oldko.session_leases(scope,lease_key,session_id,server_id,state,account_id,character_id,generation,acquired_at,heartbeat_at,lease_until,version,payload)
VALUES ('character','2001','ws30-session','ws30-ci','active','1001','2001',1,
  (extract(epoch from clock_timestamp())*1000)::bigint,
  (extract(epoch from clock_timestamp())*1000)::bigint,
  (extract(epoch from clock_timestamp())*1000)::bigint + 600000,
  1,'{"source":"ws30"}'::jsonb);

SELECT setval(pg_get_serial_sequence('oldko.accounts','id'), (SELECT max(id) FROM oldko.accounts), true);
SELECT setval(pg_get_serial_sequence('oldko.characters','id'), (SELECT max(id) FROM oldko.characters), true);
SELECT setval(pg_get_serial_sequence('oldko.item_instances','id'), (SELECT max(id) FROM oldko.item_instances), true);
SELECT setval(pg_get_serial_sequence('oldko.character_items','id'), (SELECT max(id) FROM oldko.character_items), true);
SELECT setval(pg_get_serial_sequence('oldko.inventory','id'), (SELECT max(id) FROM oldko.inventory), true);
SELECT setval(pg_get_serial_sequence('oldko.inn_storage','id'), (SELECT max(id) FROM oldko.inn_storage), true);
SELECT setval(pg_get_serial_sequence('oldko.bans','id'), (SELECT max(id) FROM oldko.bans), true);
SELECT setval(pg_get_serial_sequence('oldko.audit_log','id'), (SELECT max(id) FROM oldko.audit_log), true);
SELECT setval(pg_get_serial_sequence('oldko.item_serial_events','id'), (SELECT max(id) FROM oldko.item_serial_events), true);

COMMIT;
