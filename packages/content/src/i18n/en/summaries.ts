import type { TaskId } from '../../ids';
import type { SummaryPatch } from '../../localize';

import bath from './bath.json';
import brush from './brush.json';
import dress from './dress.json';
import emotion from './emotion.json';
import feed from './feed.json';
import learn from './learn.json';
import sleep from './sleep.json';
import sport from './sport.json';
import tidy from './tidy.json';
import wash from './wash.json';

/** 英文摘要补丁集中成一个小 chunk：切语言时只下载这一份（约 4 KB） */
export const EN_SUMMARY_PATCHES: Record<TaskId, SummaryPatch> = {
  brush, wash, feed, dress, bath, sleep, tidy, sport, emotion, learn,
};
