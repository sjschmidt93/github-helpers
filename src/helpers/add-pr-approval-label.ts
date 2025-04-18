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

import { CORE_APPROVED_PR_LABEL, PEER_APPROVED_PR_LABEL } from '../constants';
import { HelperInputs } from '../types/generated';
import { context } from '@actions/github';
import { getCoreMemberLogins } from '../utils/get-core-member-logins';
import { octokit } from '../octokit';

export class AddPrApprovalLabel extends HelperInputs {
  login = '';
  declare teams?: string;
}

export const addPrApprovalLabel = async ({ teams, login }: AddPrApprovalLabel) => {
  const coreMemberLogins = await getCoreMemberLogins(context.issue.number, teams?.split('\n'));
  const approvalLabel = coreMemberLogins.includes(login) ? CORE_APPROVED_PR_LABEL : PEER_APPROVED_PR_LABEL;
  return octokit.issues.addLabels({
    labels: [approvalLabel],
    issue_number: context.issue.number,
    ...context.repo
  });
};
