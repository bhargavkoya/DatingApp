import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, of, take } from 'rxjs';
import { environment } from 'src/environments/environment';
import { Member } from '../_models/member';
import { PaginatedResult } from '../_models/pagination';
import { User } from '../_models/user';
import { UserParams } from '../_models/UserParams';
import { AccountService } from './account.service';
import { getPaginatedResult, getPaginationHeaders } from './paginationHelper';

@Injectable({
  providedIn: 'root'
})
export class MembersService {
  baseUrl = environment.apiUrl;
  members: Member[] = [];
  paginatedResult : PaginatedResult<Member[]>= new PaginatedResult<Member[]>();
  memberCache = new Map();
  user:User;
  userParams:UserParams;


  constructor(private http:HttpClient,private accountService:AccountService) {
    this.accountService.currentUser$.pipe(take(1)).subscribe(user=>{
      this.user=user;
      this.userParams=new UserParams(user);
    })
   }

   getUserParams() {
    return this.userParams;
  }

  setUserParams(params: UserParams) {
    this.userParams = params;
  }
  
  resetUserParams() {
    this.userParams = new UserParams(this.user);
    //this.getMembers(this.userParams);
    return this.userParams;
  }

  addLike(username: string) {
    return this.http.post(this.baseUrl + 'likes/' + username, {})
  }
  getLikes(predicate: string,pageNumber, pageSize) {
    let params = getPaginationHeaders(pageNumber, pageSize);
    params = params.append('predicate', predicate);
    return getPaginatedResult<Partial<Member[]>>(this.baseUrl + 'likes', params,this.http);
    //return this.http.get<Partial<Member[]>>(this.baseUrl+'likes?predicate='+predicate);
  }


  getMembers(userParams: UserParams) {
   // if (this.members.length > 0) return of(this.members);
   var response = this.memberCache.get(Object.values(userParams).join('-'));
   if (response) {
     return of(response);
   }

   let params = getPaginationHeaders(userParams.pageNumber, userParams.pageSize);

   params = params.append('minAge', userParams.minAge.toString());
   params = params.append('maxAge', userParams.maxAge.toString());
   params = params.append('gender', userParams.gender);
   params = params.append('orderBy', userParams.orderBy);



   return getPaginatedResult<Member[]>(this.baseUrl+'users',params,this.http)
   .pipe(map(response=>{
    this.memberCache.set(Object.values(userParams).join('-'), response);
    return response;
   }));

  }

 


  setMainPhoto(photoId: number) {
    return this.http.put(this.baseUrl + 'users/set-main-photo/' + photoId, {});
  }

  getMember(username: string) {
    const member = [...this.memberCache.values()]
    .reduce((arr, elem) => arr.concat(elem.result), [])
    .find((member: Member) => member.username === username);

  if (member) {
    return of(member);
  }

    return this.http.get<Member>(this.baseUrl + 'users/' + username);
  }

  updateMember(member:Member){
    return this.http.put(this.baseUrl + 'users', member).pipe(
      map(() => {
        const index = this.members.indexOf(member);
        this.members[index] = member;
      })
    )

  }

  deletePhoto(photoId:number){
    return this.http.delete(this.baseUrl+'users/delete-photo/'+photoId);
  }
}
