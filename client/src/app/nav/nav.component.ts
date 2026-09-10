import { Component, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Observable } from 'rxjs';
import { User } from '../_models/user';
import { AccountService } from '../_services/account.service';
import { MembersService } from '../_services/members.service';
import { FormsModule } from '@angular/forms';
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { HasRoleDirective } from '../_directives/has-role.directive';
import { AsyncPipe, TitleCasePipe } from '@angular/common';

@Component({
    selector: 'app-nav',
    templateUrl: './nav.component.html',
    styleUrls: ['./nav.component.css'],
    imports: [RouterLink, RouterLinkActive, HasRoleDirective, BsDropdownModule, FormsModule, AsyncPipe, TitleCasePipe]
})
export class NavComponent implements OnInit {

  model:any={};
  
  //loggedIn:boolean;
  //currentUser$:Observable<User>;
  constructor(public accountService:AccountService,private router:Router,private toastr:ToastrService) { }

  ngOnInit(): void {
    //this.currentUser$=this.accountService.currentUser$;
    
  }
  login(){
    this.accountService.login(this.model).subscribe(response=>{
      this.router.navigateByUrl("/members");
      console.log(response);
      this.toastr.success("Login Succeeded");
      //this.loggedIn=true;
    },
    error=>{
      console.log(error);
      this.toastr.error(error.error);
    }
    );
    
  }

  logout(){
    //this.loggedIn=false;
    this.router.navigateByUrl("/");
    
    this.accountService.logout();
    
  }
 

}
