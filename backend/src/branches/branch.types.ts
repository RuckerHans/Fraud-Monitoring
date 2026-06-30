export interface DatacenterBranch {
  id: string | number;
  branchcode: string;
  branchname: string;
  branchservername: string;
  branchserverdatabasename: string;
  branchserverusername: string;
  branchserverpassword: string;
  branchserverport?: string | number;
  isactive: string | number | boolean;
  branchconnected: string | number | boolean;
}

export interface PublicBranch {
  id: string;
  code: string;
  name: string;
  online: boolean;
}
