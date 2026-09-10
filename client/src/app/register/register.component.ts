import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { AbstractControl, UntypedFormBuilder, FormControl, UntypedFormGroup, ValidatorFn, Validators, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { AccountService } from '../_services/account.service';
import { JsonPipe } from '@angular/common';
import { DateInputComponent } from '../_forms/date-input/date-input.component';
import { TextInputComponent } from '../_forms/text-input/text-input.component';

@Component({
    selector: 'app-register',
    templateUrl: './register.component.html',
    styleUrls: ['./register.component.css'],
    standalone: true,
    imports: [FormsModule, ReactiveFormsModule, TextInputComponent, DateInputComponent, JsonPipe]
})
export class RegisterComponent implements OnInit {
  
  @Output() cancelRegister = new EventEmitter();
  registerForm:UntypedFormGroup;
  maxDate:Date;
  validationErrors: string[] = [];


  
  constructor(private accountService: AccountService,private toastr:ToastrService,
              private fb: UntypedFormBuilder,private router:Router) { }

  ngOnInit(): void {
    this.initializeForm();
    this.maxDate = new Date();
    this.maxDate.setFullYear(this.maxDate.getFullYear() -18);

  }

  initializeForm(){
    this.registerForm = this.fb.group({
      gender: ['male'],
      username: ['', Validators.required],
      knownAs: ['', Validators.required],
      dateOfBirth: ['', Validators.required],
      city: ['', Validators.required],
      country: ['', Validators.required],
      password: ['', [Validators.required, 
        Validators.minLength(4), Validators.maxLength(8)]],
      confirmPassword: ['', [Validators.required, this.matchValues('password')]]
    })

  }
  matchValues(matchTo: string): ValidatorFn {
    return (control: AbstractControl) => {
      return control?.value === control?.parent?.controls[matchTo].value 
        ? null : {isMatching: true}
    }
  }

  register(){
    
    this.accountService.register(this.registerForm.value).subscribe(response => {
      this.router.navigateByUrl('/members');


    }, error => {
      this.validationErrors = error;

    })

  }
  cancel(){
    this.cancelRegister.emit(false);
    this.toastr.info("Registration Cancelled");
  }
}

