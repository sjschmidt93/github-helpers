/*
Copyright 2021 Expedia, Inc.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as core from '@actions/core';
import { HelperInputs } from '../types/generated';
import { context } from '@actions/github';
import micromatch from 'micromatch';
import { octokit } from '../octokit';
import { getPrNumberFromMergeQueueRef } from '../utils/merge-queue';
import { GITHUB_OPTIONS } from '../constants';
import { ChangedFilesList } from '../types/github';

export class FilterPaths extends HelperInputs {
  declare paths?: string;
  declare globs?: string;
  declare sha?: string;
  declare packages?: string;
}

export const filterPaths = async ({ paths, globs, sha, packages }: FilterPaths) => {
  if (!paths && !globs && !packages) {
    core.error('Must pass `globs` or `paths` or `packages` for filtering');
    return false;
  }

  const listPrsResult = sha
    ? await octokit.repos.listPullRequestsAssociatedWithCommit({
        commit_sha: sha,
        ...context.repo,
        ...GITHUB_OPTIONS
      })
    : undefined;
  const prNumberFromSha = listPrsResult?.data.find(Boolean)?.number;
  const pull_number = context.eventName === 'merge_group' ? getPrNumberFromMergeQueueRef() : (prNumberFromSha ?? context.issue.number);

  const { data } = await octokit.pulls.listFiles({
    per_page: 100,
    pull_number,
    ...context.repo
  });

  if (packages && hasRelevantPackageChanged(data, packages)) {
    return true;
  }

  const fileNames = data.map(file => file.filename);
  if (globs) {
    if (paths) core.info('`paths` and `globs` inputs found, defaulting to use `globs` for filtering');
    return micromatch(fileNames, globs.split('\n')).length > 0;
  } else if (paths) {
    const filePaths = paths.split('\n');
    return fileNames.some(changedFile => filePaths.some(filePath => changedFile.startsWith(filePath)));
  }
};

const hasRelevantPackageChanged = (files: ChangedFilesList, packages: string) => {
  const packageJson = files.find(file => file.filename === 'package.json');
  if (!packageJson) {
    return false;
  }

  return packages.split('\n').some(pkg => packageJson.patch?.includes(pkg));
};
