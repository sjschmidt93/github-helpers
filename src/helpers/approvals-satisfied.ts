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

import { HelperInputs } from '../types/generated';
import { context } from '@actions/github';
import { getRequiredCodeOwnersEntries } from '../utils/get-core-member-logins';
import { map } from 'bluebird';
import { CodeOwnersEntry } from 'codeowners-utils';
import * as core from '@actions/core';
import { paginateAllReviews } from '../utils/paginate-all-reviews';
import { uniq, uniqBy } from 'lodash';
import { createPrComment } from './create-pr-comment';
import { paginateMembersInOrg } from '../utils/paginate-members-in-org';

export class ApprovalsSatisfied extends HelperInputs {
  declare teams?: string;
  declare users?: string;
  declare codeowners_overrides?: string;
  declare number_of_reviewers?: string;
  declare required_review_overrides?: string;
  declare pull_number?: string;
  declare body?: string;
}

export const approvalsSatisfied = async ({
  teams,
  users,
  codeowners_overrides,
  number_of_reviewers = '1',
  required_review_overrides,
  pull_number,
  body
}: ApprovalsSatisfied = {}) => {
  const prNumber = pull_number ? Number(pull_number) : context.issue.number;

  const teamOverrides = required_review_overrides?.split(',').map(overrideString => {
    const [team, numberOfRequiredReviews] = overrideString.split(':');
    return { team, numberOfRequiredReviews };
  });
  const teamsList = updateTeamsList(teams?.split('\n'));
  if (!validateTeamsList(teamsList)) {
    core.setFailed('If teams input is in the format "org/team", then the org must be the same as the repository org');
    return false;
  }
  const usersList = users?.split('\n');

  const logs = [];

  const reviews = await paginateAllReviews(prNumber);
  const approverLogins = reviews
    .filter(({ state }) => state === 'APPROVED')
    .map(({ user }) => user?.login)
    .filter(Boolean);
  logs.push(`PR already approved by: ${approverLogins.toString()}`);

  const requiredCodeOwnersEntries =
    teamsList || usersList
      ? createArtificialCodeOwnersEntry({ teams: teamsList, users: usersList })
      : await getRequiredCodeOwnersEntries(prNumber, codeowners_overrides);
  const requiredCodeOwnersEntriesWithOwners = uniqBy(
    requiredCodeOwnersEntries.filter(({ owners }) => owners.length),
    'owners'
  );

  const codeOwnersEntrySatisfiesApprovals = async (entry: Pick<CodeOwnersEntry, 'owners'>) => {
    const loginsLists = await map(entry.owners, async teamOrUsers => {
      if (isTeam(teamOrUsers)) {
        const members = await paginateMembersInOrg(teamOrUsers);
        return members.map(({ login }) => login);
      } else {
        return teamOrUsers.replaceAll('@', '').split(',');
      }
    });
    const codeOwnerLogins = uniq(loginsLists.flat());

    const numberOfApprovals = approverLogins.filter(login => codeOwnerLogins.includes(login)).length;

    const numberOfRequiredReviews =
      teamOverrides?.find(({ team }) => team && entry.owners.includes(team))?.numberOfRequiredReviews ?? number_of_reviewers;
    logs.push(`Current number of approvals satisfied for ${entry.owners}: ${numberOfApprovals}`);
    logs.push(`Number of required reviews: ${numberOfRequiredReviews}`);

    return numberOfApprovals >= Number(numberOfRequiredReviews);
  };

  if (requiredCodeOwnersEntriesWithOwners.length) {
    logs.push(`Required code owners: ${requiredCodeOwnersEntriesWithOwners.map(({ owners }) => owners).toString()}`);
  }

  const booleans = await Promise.all(requiredCodeOwnersEntriesWithOwners.map(codeOwnersEntrySatisfiesApprovals));
  const approvalsSatisfied = booleans.every(Boolean);

  if (!approvalsSatisfied) {
    logs.unshift('Required approvals not satisfied:\n');

    if (body) {
      logs.unshift(body + '\n');

      await createPrComment({
        body: logs.join('\n')
      });
    }
  }

  core.info(logs.join('\n'));

  return approvalsSatisfied;
};

const createArtificialCodeOwnersEntry = ({ teams = [], users = [] }: { teams?: string[]; users?: string[] }) => [
  { owners: teams.concat(users) }
];
const isTeam = (teamOrUsers: string) => teamOrUsers.includes('/');
const updateTeamsList = (teamsList?: string[]) => {
  return teamsList?.map(team => {
    if (!team.includes('/')) {
      return `${context.repo.owner}/${team}`;
    } else {
      return team;
    }
  });
};

const validateTeamsList = (teamsList?: string[]) => {
  return (
    teamsList?.every(team => {
      const inputOrg = team.split('/')[0];
      return inputOrg === context.repo.owner;
    }) ?? true
  );
};
